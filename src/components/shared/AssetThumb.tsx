/**
 * AssetThumb — 资产缩略图外壳（AssetsPanel / AssetSearchWindow 卡片共用）
 * 统一图片/图标展示 + 体积角标 + 来源角标 + 操作按钮插槽，消除两处卡片的视觉重复。
 */
import type { ReactNode } from 'react';
import type { FileCategory } from '../../services/fileService';
import { CATEGORY_ICONS, formatSize } from '../../utils/assetFormat';
import ViewportImage from './ViewportImage';
import ResourceVideoPreview from './ResourceVideoPreview';

interface AssetThumbProps {
  assetUrl?: string;
  filePath?: string;
  videoExpanded?: boolean;
  videoPresentation?: 'inline' | 'fullscreen';
  videoProjectId?: string;
  onVideoExpandedChange?: (expanded: boolean) => void;
  name: string;
  category: FileCategory;
  size: number;
  /** 右上角来源/标记角标文字（如「外部」「全局」「项目名」），为空不显示 */
  badge?: string;
  /** 悬停操作按钮区 */
  children?: ReactNode;
  onImagePreview?: () => void;
}

export default function AssetThumb({ assetUrl, filePath, videoExpanded = false, videoPresentation, videoProjectId, onVideoExpandedChange, name, category, size, badge, children, onImagePreview }: AssetThumbProps) {
  return category === 'video' ? (
    <div className="assets-card-img-wrap assets-card-video-wrap">
      <ResourceVideoPreview src={assetUrl} filePath={filePath} name={name} expanded={videoExpanded}
        presentation={videoPresentation} projectId={videoProjectId} size={size}
        onExpandedChange={(expanded) => onVideoExpandedChange?.(expanded)} />
      <span className="assets-card-size">{formatSize(size)}</span>
      {badge && <span className="assets-card-badge">{badge}</span>}
      {children}
    </div>
  ) : assetUrl ? (
    <div className="assets-card-img-wrap">
      <ViewportImage src={assetUrl} alt={name} className="assets-card-img" draggable={false} />
      {category === 'image' && onImagePreview && <button type="button" className="asset-image-preview-trigger"
        aria-label={`查看图片 ${name}`} title="查看大图和生成信息" onClick={(event) => { event.stopPropagation(); onImagePreview(); }} />}
      <span className="assets-card-size">{formatSize(size)}</span>
      {badge && <span className="assets-card-badge">{badge}</span>}
      {children}
    </div>
  ) : (
    <div className="assets-card-icon-wrap">
      <span className="assets-card-icon">{CATEGORY_ICONS[category]}</span>
      <span className="assets-card-size">{formatSize(size)}</span>
      {badge && <span className="assets-card-badge">{badge}</span>}
      {children}
    </div>
  );
}
