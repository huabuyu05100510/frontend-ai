import fs from 'fs';
import path from 'path';

export async function injectSkeletonSW(projectRoot: string) {
  // 根据不同项目类型自动注入 SW
  // 支持 CRA、Vite、Next 等
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.warn('[Smarty Skeleton] package.json not found, skipping SW injection.');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const isCRA = pkg.dependencies && pkg.dependencies['react-scripts'];
  const isVite = pkg.devDependencies && pkg.devDependencies['vite'];

  if (isCRA) {
    const swRegisterPath = path.join(projectRoot, 'src', 'serviceWorkerRegistration.js');
    if (fs.existsSync(swRegisterPath)) {
      console.log('[Smarty Skeleton] CRA project detected, append SW registration.');
      let content = fs.readFileSync(swRegisterPath, 'utf-8');
      if (!content.includes('_smarty/skeleton-sw.js')) {
        content += `\nif ('serviceWorker' in navigator) { navigator.serviceWorker.register('_smarty/skeleton-sw.js'); }`;
        fs.writeFileSync(swRegisterPath, content);
      }
    }
  } else if (isVite) {
    const mainPath = path.join(projectRoot, 'src', 'main.ts');
    if (fs.existsSync(mainPath)) {
      console.log('[Smarty Skeleton] Vite project detected, append SW registration.');
      let content = fs.readFileSync(mainPath, 'utf-8');
      if (!content.includes('_smarty/skeleton-sw.js')) {
        content += `\nif('serviceWorker' in navigator){navigator.serviceWorker.register('_smarty/skeleton-sw.js');}`;
        fs.writeFileSync(mainPath, content);
      }
    }
  } else {
    console.warn('[Smarty Skeleton] Unknown project type. You need to register the SW manually.');
  }
}
