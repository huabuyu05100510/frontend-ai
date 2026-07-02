import * as CORE from '@smarty-skeleton-toolchain/core';

export function generateSkeleton(root: HTMLElement) {
  return (CORE as any).generateSkeleton(root); // 如果 core 里名字是 generateSkeleton
}

export function renderSkeleton(skel: any) {
    console.log("red")
    return null
//   return (CORE as any).renderSkeleton(skel);   // 同上
}
