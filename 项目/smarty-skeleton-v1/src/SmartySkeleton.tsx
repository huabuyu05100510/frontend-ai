import React, { useState, useEffect, useRef, ReactNode } from 'react';
import generateSkeleton from './generate/generateSkeleton';
import localforage from './generate/localforage';
import './index.less';

interface SmartySkeletonProps {
  id: string;
  loading: boolean;
  children: ReactNode;
  delayTime?: number;
  background?: string;
}

const SmartySkeleton: React.FC<SmartySkeletonProps> = ({
  id,
  loading,
  children,
  delayTime = 50,
  background = '#f4f4f4',
  ...others
}) => {
  const path = window.location.origin + window.location.pathname;
  const key = `${path}-${id}-${window.innerWidth}-${window.innerHeight}`;

  const [cacheDOM, setCacheDom] = useState<string | null>(null);
  const [sizes, setSizes] = useState<{ width: string; height: string }>({
    width: 'auto',
    height: 'auto',
  });
  const [hasCache, setHasCache] = useState(false);

  const instance = useRef<generateSkeleton>();
  const timeRef = useRef<number>();

  // 读取缓存
  useEffect(() => {
    try {
      localforage.getItem(key, (err: any, value: any) => {
        if (!err && value) setCacheDom(value);
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (loading) return;

    setSizes({ width: 'auto', height: 'auto' });

    timeRef.current = window.setTimeout(() => {
      const root = document.getElementById(id);
      if (!root) return;

      instance.current = new generateSkeleton({ root, id, ...others });
      instance.current.performWorkUnit();
    }, delayTime);

    return () => {
      instance.current?.cancelTask();
      if (timeRef.current) clearTimeout(timeRef.current);
    };
  }, [loading]);

  return (
    <div
      className={`ske-wrap ${loading ? 'loading' : 'loaded'} ${
        hasCache && loading ? 'loadingWithCache' : ''
      }`}
      style={{
        '--width': sizes.width,
        '--height': sizes.height,
        '--bg': background,
      } as React.CSSProperties}
    >
      <div
        className="ske-innerwrap"
        id="ske-innerwrap"
        dangerouslySetInnerHTML={{ __html: cacheDOM || '' }}
      />
      <div id={id} className="ske-real-dom">
        {children}
      </div>
    </div>
  );
};

export default SmartySkeleton;
