use rusqlite::{params, params_from_iter, types::Value, Connection};
use rust_xlsxwriter::Workbook;
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use tauri::{Manager, Webview};

use crate::path_policy::{authorize_existing_plain_directory, ensure_trusted_caller};

#[derive(Default)]
pub struct BillingStoragePath(pub Mutex<Option<PathBuf>>);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingRun {
    pub id: String,
    pub app_project_id: String,
    pub app_project_name: String,
    pub connection_id: String,
    pub node_id: String,
    pub node_type: String,
    pub node_label: String,
    pub model_type: String,
    pub model_id: String,
    pub status: String,
    pub submitted_at: i64,
    pub finished_at: Option<i64>,
    pub task_id: Option<String>,
    pub request_id: Option<String>,
    pub prompt: String,
    pub input_json: String,
    pub price_json: String,
    pub estimated_micros: Option<i64>,
    pub calculated_micros: Option<i64>,
    pub amount_confidence: String,
    pub error_message: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingFilter {
    pub app_project_id: Option<String>,
    pub model_type: Option<String>,
    pub model_id: Option<String>,
    pub status: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingPage {
    pub items: Vec<BillingRun>,
    pub total: i64,
    pub estimated_micros: i64,
    pub calculated_micros: i64,
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.state::<BillingStoragePath>().0.lock().map_err(|_| "账本路径状态不可用")?.clone()
        .unwrap_or(app.path().app_data_dir().map_err(|e| e.to_string())?.join("billing"));
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join("volcengine-usage.sqlite"))
}

fn checkpoint_and_close(path: &Path) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    let connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn billing_set_storage_path(webview: Webview, app: tauri::AppHandle, path: String) -> Result<String, String> {
    ensure_trusted_caller(&webview)?;
    let directory = authorize_existing_plain_directory(&app, &path)?;
    let target = directory.join("volcengine-usage.sqlite");
    let previous = database_path(&app)?;
    if previous == target {
        return Ok(target.to_string_lossy().into_owned());
    }
    checkpoint_and_close(&previous)?;
    if target.exists() {
        return Err("目标目录中已存在火山方舟账本，请先选择其他目录".into());
    }
    if previous.exists() {
        fs::copy(&previous, &target).map_err(|e| format!("复制账本失败：{e}"))?;
        for suffix in ["-wal", "-shm"] {
            let source = PathBuf::from(format!("{}{}", previous.display(), suffix));
            if source.exists() {
                let destination = PathBuf::from(format!("{}{}", target.display(), suffix));
                if let Err(error) = fs::copy(&source, &destination) {
                    let _ = fs::remove_file(&target);
                    return Err(format!("复制账本附属文件失败：{error}"));
                }
            }
        }
    }
    let connection = Connection::open(&target).map_err(|e| e.to_string())?;
    connection.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    connection.execute_batch("PRAGMA integrity_check;").map_err(|e| e.to_string())?;
    drop(connection);
    *app.state::<BillingStoragePath>().0.lock().map_err(|_| "账本路径状态不可用")? = Some(directory);
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn billing_get_storage_path(webview: Webview, app: tauri::AppHandle) -> Result<String, String> {
    ensure_trusted_caller(&webview)?;
    Ok(database_path(&app)?.to_string_lossy().into_owned())
}

fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let mut connection = Connection::open(database_path(app)?).map_err(|e| e.to_string())?;
    connection.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS billing_runs (
           id TEXT PRIMARY KEY, app_project_id TEXT NOT NULL, app_project_name TEXT NOT NULL,
           connection_id TEXT NOT NULL,
           node_id TEXT NOT NULL, node_type TEXT NOT NULL, node_label TEXT NOT NULL,
           model_type TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL,
           submitted_at INTEGER NOT NULL, finished_at INTEGER, task_id TEXT, request_id TEXT,
           prompt TEXT NOT NULL, input_json TEXT NOT NULL, price_json TEXT NOT NULL,
           estimated_micros INTEGER, calculated_micros INTEGER,
           amount_confidence TEXT NOT NULL, error_message TEXT
         );
         CREATE INDEX IF NOT EXISTS billing_project_time ON billing_runs(app_project_id, submitted_at DESC);
         CREATE INDEX IF NOT EXISTS billing_model_time ON billing_runs(model_type, model_id, submitted_at DESC);
         CREATE INDEX IF NOT EXISTS billing_status_time ON billing_runs(status, submitted_at DESC);
         CREATE INDEX IF NOT EXISTS billing_task ON billing_runs(task_id);",
    ).map_err(|e| e.to_string())?;
    migrate_legacy(&mut connection)?;
    Ok(connection)
}

fn migrate_legacy(connection: &mut Connection) -> Result<(), String> {
    let has_ark_project = {
        let mut statement = connection.prepare("PRAGMA table_info(billing_runs)").map_err(|e| e.to_string())?;
        let columns = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
        columns.iter().any(|name| name == "ark_project_name")
    };
    if !has_ark_project { return Ok(()); }

    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    transaction.execute_batch("UPDATE billing_runs SET input_json = CASE
        WHEN json_valid(input_json) THEN json_remove(input_json,
            '$.assetId', '$.assetIds', '$.assetGroupId', '$.assetGroupIds', '$.arkProjectName', '$.projectName')
        ELSE '{}' END;")
        .map_err(|e| e.to_string())?;
    transaction.execute_batch("ALTER TABLE billing_runs DROP COLUMN ark_project_name; PRAGMA user_version=1;")
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

fn validate(run: &BillingRun) -> Result<(), String> {
    if run.id.is_empty() || run.app_project_id.is_empty() || run.node_id.is_empty()
        || run.model_id.is_empty() || run.prompt.len() > 100_000
        || run.input_json.len() > 50_000 || run.price_json.len() > 20_000
        || !["image", "video"].contains(&run.model_type.as_str())
        || !["submitting", "running", "succeeded", "failed", "cancelled", "unknown"].contains(&run.status.as_str())
    {
        return Err("计费记录字段无效".into());
    }
    Ok(())
}

#[tauri::command]
pub fn billing_upsert(webview: Webview, app: tauri::AppHandle, run: BillingRun) -> Result<(), String> {
    ensure_trusted_caller(&webview)?;
    validate(&run)?;
    let connection = open(&app)?;
    connection.execute(
        "INSERT INTO billing_runs VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, finished_at=excluded.finished_at,
         task_id=excluded.task_id, request_id=excluded.request_id, input_json=excluded.input_json,
         calculated_micros=excluded.calculated_micros, amount_confidence=excluded.amount_confidence,
         error_message=excluded.error_message",
        params![run.id, run.app_project_id, run.app_project_name, run.connection_id,
            run.node_id, run.node_type, run.node_label, run.model_type,
            run.model_id, run.status, run.submitted_at, run.finished_at, run.task_id,
            run.request_id, run.prompt, run.input_json, run.price_json, run.estimated_micros,
            run.calculated_micros, run.amount_confidence, run.error_message],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn where_clause(filter: &BillingFilter) -> (String, Vec<Value>) {
    let mut conditions = vec!["1=1".to_string()];
    let mut values = Vec::new();
    for (column, value) in [
        ("app_project_id", &filter.app_project_id),
        ("model_type", &filter.model_type),
        ("model_id", &filter.model_id),
        ("status", &filter.status),
    ] {
        if let Some(value) = value.as_ref().filter(|value| !value.is_empty()) {
            conditions.push(format!("{column}=?"));
            values.push(Value::Text(value.clone()));
        }
    }
    if let Some(from) = filter.from {
        conditions.push("submitted_at>=?".to_string());
        values.push(Value::Integer(from));
    }
    if let Some(to) = filter.to {
        conditions.push("submitted_at<?".to_string());
        values.push(Value::Integer(to));
    }
    (conditions.join(" AND "), values)
}

fn read_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<BillingRun> {
    Ok(BillingRun {
        id: row.get(0)?, app_project_id: row.get(1)?, app_project_name: row.get(2)?,
        connection_id: row.get(3)?, node_id: row.get(4)?,
        node_type: row.get(5)?, node_label: row.get(6)?, model_type: row.get(7)?,
        model_id: row.get(8)?, status: row.get(9)?, submitted_at: row.get(10)?,
        finished_at: row.get(11)?, task_id: row.get(12)?, request_id: row.get(13)?,
        prompt: row.get(14)?, input_json: row.get(15)?, price_json: row.get(16)?,
        estimated_micros: row.get(17)?, calculated_micros: row.get(18)?,
        amount_confidence: row.get(19)?, error_message: row.get(20)?,
    })
}

const COLUMNS: &str = "id,app_project_id,app_project_name,connection_id,node_id,node_type,node_label,model_type,model_id,status,submitted_at,finished_at,task_id,request_id,prompt,input_json,price_json,estimated_micros,calculated_micros,amount_confidence,error_message";

fn query(connection: &Connection, filter: &BillingFilter, page: u32, page_size: u32) -> Result<BillingPage, String> {
    let (condition, values) = where_clause(filter);
    let totals: (i64, i64, i64) = connection.query_row(
        &format!("SELECT COUNT(*), COALESCE(SUM(estimated_micros),0), COALESCE(SUM(calculated_micros),0) FROM billing_runs WHERE {condition}"),
        params_from_iter(values.iter()), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|e| e.to_string())?;
    let limit = page_size.clamp(1, 200) as i64;
    let offset = (page.max(1) as i64 - 1).saturating_mul(limit);
    let mut statement = connection.prepare(&format!("SELECT {COLUMNS} FROM billing_runs WHERE {condition} ORDER BY submitted_at DESC,id DESC LIMIT {limit} OFFSET {offset}")).map_err(|e| e.to_string())?;
    let items = statement.query_map(params_from_iter(values.iter()), read_run)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    Ok(BillingPage { items, total: totals.0, estimated_micros: totals.1, calculated_micros: totals.2 })
}

#[tauri::command]
pub fn billing_query(webview: Webview, app: tauri::AppHandle, filter: BillingFilter, page: u32, page_size: u32) -> Result<BillingPage, String> {
    ensure_trusted_caller(&webview)?;
    query(&open(&app)?, &filter, page, page_size)
}

#[tauri::command]
pub fn billing_get_by_task(webview: Webview, app: tauri::AppHandle, task_id: String, app_project_id: String) -> Result<Option<BillingRun>, String> {
    ensure_trusted_caller(&webview)?;
    if task_id.is_empty() || task_id.len() > 256 { return Err("任务 ID 无效".into()); }
    let connection = open(&app)?;
    let mut statement = connection.prepare(&format!("SELECT {COLUMNS} FROM billing_runs WHERE task_id=?1 AND app_project_id=?2 ORDER BY submitted_at DESC LIMIT 1")).map_err(|e| e.to_string())?;
    let mut rows = statement.query(params![task_id, app_project_id]).map_err(|e| e.to_string())?;
    rows.next().map_err(|e| e.to_string())?.map(read_run).transpose().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn billing_clear(webview: Webview, app: tauri::AppHandle, filter: BillingFilter, expected_count: i64) -> Result<usize, String> {
    ensure_trusted_caller(&webview)?;
    let mut connection = open(&app)?;
    let (condition, values) = where_clause(&filter);
    let safe_condition = format!("{condition} AND status NOT IN ('submitting','running','unknown')");
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let count: i64 = transaction.query_row(
        &format!("SELECT COUNT(*) FROM billing_runs WHERE {safe_condition}"),
        params_from_iter(values.iter()), |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if count != expected_count || count == 0 { return Err("清理预览已变化，请重新确认".into()); }
    let deleted = transaction.execute(&format!("DELETE FROM billing_runs WHERE {safe_condition}"), params_from_iter(values.iter())).map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(deleted)
}

#[tauri::command]
pub fn billing_clear_preview(webview: Webview, app: tauri::AppHandle, filter: BillingFilter) -> Result<BillingPage, String> {
    ensure_trusted_caller(&webview)?;
    let filter = filter;
    if let Some(status) = filter.status.as_deref() {
        if ["submitting", "running", "unknown"].contains(&status) { return Ok(BillingPage { items: Vec::new(), total: 0, estimated_micros: 0, calculated_micros: 0 }); }
    }
    let mut page = query(&open(&app)?, &filter, 1, 1)?;
    page.items.clear();
    // The clear command rechecks the exact count in a transaction.
    if filter.status.is_none() {
        let connection = open(&app)?;
        let (condition, values) = where_clause(&filter);
        let (total, estimated, calculated): (i64, i64, i64) = connection.query_row(
            &format!("SELECT COUNT(*),COALESCE(SUM(estimated_micros),0),COALESCE(SUM(calculated_micros),0) FROM billing_runs WHERE {condition} AND status NOT IN ('submitting','running','unknown')"),
            params_from_iter(values.iter()), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| e.to_string())?;
        page.total = total; page.estimated_micros = estimated; page.calculated_micros = calculated;
    }
    Ok(page)
}

#[tauri::command]
pub fn billing_export(webview: Webview, app: tauri::AppHandle, filter: BillingFilter, include_prompts: bool) -> Result<Vec<u8>, String> {
    ensure_trusted_caller(&webview)?;
    let connection = open(&app)?;
    connection.execute_batch("BEGIN DEFERRED").map_err(|e| e.to_string())?;
    let total = query(&connection, &filter, 1, 1)?.total;
    if total > 10_000 { return Err("一次最多导出 10000 条，请缩小筛选范围".into()); }
    let mut runs = Vec::new();
    for page in 1..=((total as u32 + 199) / 200) {
        runs.extend(query(&connection, &filter, page, 200)?.items);
    }
    let mut workbook = Workbook::new();
    let summary = workbook.add_worksheet();
    summary.set_name("汇总").map_err(|e| e.to_string())?;
    summary.write_string(0, 0, "火山方舟本地用量账本（非官方账单）").map_err(|e| e.to_string())?;
    summary.write_string(1, 0, "记录数").map_err(|e| e.to_string())?;
    summary.write_number(1, 1, total as f64).map_err(|e| e.to_string())?;
    summary.write_string(2, 0, "预计费用（元）").map_err(|e| e.to_string())?;
    summary.write_number(2, 1, runs.iter().filter_map(|run| run.estimated_micros).sum::<i64>() as f64 / 1_000_000.0).map_err(|e| e.to_string())?;
    summary.write_string(3, 0, "按 Usage/产物核算（元）").map_err(|e| e.to_string())?;
    summary.write_number(3, 1, runs.iter().filter_map(|run| run.calculated_micros).sum::<i64>() as f64 / 1_000_000.0).map_err(|e| e.to_string())?;
    summary.write_string(4, 0, "金额为刊例估算，优惠、资源包与税费未计入").map_err(|e| e.to_string())?;
    let sheet = workbook.add_worksheet();
    sheet.set_name("运行记录").map_err(|e| e.to_string())?;
    for (column, label) in ["提交时间戳(ms)", "本地项目", "节点", "模型类型", "模型", "状态", "预计元", "核算元", "费用口径", "提示词", "运行 ID", "任务 ID"].iter().enumerate() {
        sheet.write_string(0, column as u16, *label).map_err(|e| e.to_string())?;
    }
    for (index, run) in runs.iter().enumerate() {
        let row = index as u32 + 1;
        let values = [run.submitted_at.to_string(), run.app_project_name.clone(), run.node_label.clone(), run.model_type.clone(), run.model_id.clone(), run.status.clone(), String::new(), String::new(), run.amount_confidence.clone(), if include_prompts { run.prompt.clone() } else { "已脱敏".into() }, run.id.clone(), run.task_id.clone().unwrap_or_default()];
        for (column, value) in values.iter().enumerate() {
            if column == 6 || column == 7 {
                let amount = if column == 6 { run.estimated_micros } else { run.calculated_micros };
                if let Some(amount) = amount { sheet.write_number(row, column as u16, amount as f64 / 1_000_000.0).map_err(|e| e.to_string())?; }
                continue;
            }
            let safe = if ["=", "+", "-", "@"].iter().any(|prefix| value.starts_with(prefix)) { format!("'{value}") } else { value.clone() };
            sheet.write_string(row, column as u16, &safe).map_err(|e| e.to_string())?;
        }
    }
    let prices = workbook.add_worksheet();
    prices.set_name("价格依据").map_err(|e| e.to_string())?;
    for (column, label) in ["运行 ID", "模型类型", "模型 ID", "价格规则快照", "金额证据"].iter().enumerate() {
        prices.write_string(0, column as u16, *label).map_err(|e| e.to_string())?;
    }
    for (index, run) in runs.iter().enumerate() {
        let row = index as u32 + 1;
        for (column, value) in [&run.id, &run.model_type, &run.model_id, &run.price_json, &run.amount_confidence].iter().enumerate() {
            let safe = if ["=", "+", "-", "@"].iter().any(|prefix| value.starts_with(prefix)) { format!("'{value}") } else { (*value).clone() };
            prices.write_string(row, column as u16, &safe).map_err(|e| e.to_string())?;
        }
    }
    let bytes = workbook.save_to_buffer().map_err(|e| e.to_string())?;
    connection.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_filter_keeps_project_and_model_type_separate() {
        let filter = BillingFilter {
            app_project_id: Some("project-a".into()),
            model_type: Some("video".into()),
            model_id: Some("doubao-seedance-2-5".into()),
            ..Default::default()
        };
        let (condition, values) = where_clause(&filter);
        assert!(condition.contains("app_project_id=?"));
        assert!(condition.contains("model_type=?"));
        assert!(condition.contains("model_id=?"));
        assert_eq!(values.len(), 3);
    }

    #[test]
    fn migration_removes_avatar_fields_without_losing_usage() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE billing_runs (
            id TEXT PRIMARY KEY, ark_project_name TEXT NOT NULL, input_json TEXT NOT NULL,
            calculated_micros INTEGER NOT NULL
        );
        INSERT INTO billing_runs VALUES ('run-1', 'private-project',
            '{\"assetIds\":[\"asset-1\"],\"referenceType\":\"frame-reference\"}', 420000);
        INSERT INTO billing_runs VALUES ('run-2', 'private-project', 'invalid-json', 120000);")
            .unwrap();

        migrate_legacy(&mut connection).unwrap();
        migrate_legacy(&mut connection).unwrap();
        let (input, amount): (String, i64) = connection.query_row(
            "SELECT input_json, calculated_micros FROM billing_runs WHERE id='run-1'", [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(amount, 420000);
        assert_eq!(input, "{\"referenceType\":\"frame-reference\"}");
        let malformed: (String, i64) = connection.query_row(
            "SELECT input_json, calculated_micros FROM billing_runs WHERE id='run-2'", [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(malformed, ("{}".into(), 120000));
        let mut statement = connection.prepare("PRAGMA table_info(billing_runs)").unwrap();
        let names = statement.query_map([], |row| row.get::<_, String>(1)).unwrap()
            .collect::<rusqlite::Result<Vec<_>>>().unwrap();
        assert!(!names.contains(&"ark_project_name".to_string()));
    }
}
