/**
 * 加载骨架屏组件
 *
 * 适配三种场景形态：Canvas（灰色矩形）、文本（灰色行骨架）、图片（灰色图片占位）
 * 支持 prefers-reduced-motion 禁用动画
 *
 * @module components/LoadingSkeleton
 */

import React from 'react';

interface LoadingSkeletonProps {
  /** 变体类型 */
  variant: 'canvas' | 'text' | 'image';
  /** 宽度 */
  width?: number | string;
  /** 高度 */
  height?: number | string;
  /** text 模式行数 */
  rows?: number;
}

const baseStyle: React.CSSProperties = {
  background: '#f0f0f0',
  borderRadius: '4px',
  overflow: 'hidden',
  position: 'relative',
};

/**
 * 加载骨架屏
 */
export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  variant,
  width = '100%',
  height = '100%',
  rows = 5,
}) => {
  if (variant === 'text') {
    return (
      <div style={{ width, padding: '16px' }}>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="skeleton-line"
            style={{
              ...baseStyle,
              height: `${14 + Math.random() * 4}px`,
              marginBottom: '12px',
              width: `${60 + Math.random() * 40}%`,
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === 'image') {
    return (
      <div
        className="skeleton-image"
        style={{
          ...baseStyle,
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '200px',
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d9d9d9" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }

  // canvas 变体
  return (
    <div
      className="skeleton-canvas"
      style={{
        ...baseStyle,
        width,
        height,
        minHeight: '400px',
      }}
    />
  );
};

LoadingSkeleton.displayName = 'LoadingSkeleton';