import React, { useState, useEffect, useRef, ReactNode } from "react";
import {
  generateSkeleton,
  SkeletonDSL,
  getItem,
  decompressDSL,
} from "@smarty-skeleton-toolchain/core";
import "./index.less";

function base64ToUint8(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const len = binary.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

interface SmartySkeletonProps {
  id: string;
  loading: boolean;
  children: ReactNode;
  delayTime?: number;
  background?: string;
  placeholder?: any;
}

const renderDSLToDOM = (dsl: SkeletonDSL) => {
  const { boxes, bgs, borders } = dsl as any;

  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    width: "100%",
    height: "100%",
    top: 0,
    left: 0,
  };

  return (
    <div style={wrapperStyle}>
      {/* 背景块 */}
      {bgs.map((bg: any, idx: number) => {
        const { positionInfo, borderRadius } = bg;
        const style: React.CSSProperties = {
          position: "absolute",
          left: `${positionInfo?.l}%`,
          top: `${positionInfo?.t}%`,
          width: `${positionInfo?.w}%`,
          height: `${positionInfo?.h}%`,
          borderRadius,
          backgroundColor: bg?.backgroundColor,
          background: bg?.background,
          borderWidth: bg?.borderWidth,
          borderStyle: bg?.borderStyle,
          borderColor: bg?.borderColor,
          zIndex: 1,
        };
        return <div key={`bg-${idx}`} style={style} />;
      })}

      {/* 边框块 */}
      {borders.map((border: any, idx: number) => {
        const { positionInfo, borderRadius } = border;
        const style: React.CSSProperties = {
          position: "absolute",
          left: `${positionInfo?.l}%`,
          top: `${positionInfo?.t}%`,
          width: `${positionInfo?.w}%`,
          height: `${positionInfo?.h}%`,
          borderRadius,
          borderWidth: border?.borderWidth,
          borderStyle: border?.borderStyle,
          borderColor: border?.borderColor,
          zIndex: 2,
        };
        return <div key={`border-${idx}`} style={style} />;
      })}

      {/* 普通盒子 */}
      {boxes.map((box: any, idx: number) => {
        const { positionInfo, borderRadius } = box;
        const style: React.CSSProperties = {
          position: "absolute",
          left: `${positionInfo?.l}%`,
          top: `${positionInfo?.t}%`,
          width: `${positionInfo?.w}%`,
          height: `${positionInfo?.h}%`,
          borderRadius,
          backgroundColor: "#f4f4f4",
          zIndex: 555555,
        };
        return (
          <div key={`box-${idx}`} style={style} className="skeleton-common" />
        );
      })}
    </div>
  );
};

const SmartySkeleton: React.FC<SmartySkeletonProps> = ({
  id,
  loading,
  children,
  delayTime = 500,
  background = "#f4f4f4",
  placeholder,
  ...others
}) => {
  const path = window.location.origin + window.location.pathname;
  const key = `${path}-${id}-${window.innerWidth}-${window.innerHeight}`;
  const sizeKey = `${key}-size`;
  let hasCache = false;
  let cacheSize: any;
  let placeholderDSL: any;
  console.log(placeholder,'placeholder')
  try {
    cacheSize = localStorage.getItem(sizeKey);
    if (cacheSize) {
      hasCache = true;
      const parsed = JSON.parse(cacheSize);
      if (parsed?.width && parsed?.height) cacheSize = parsed;
      
    }
    if (!cacheSize&&placeholder) {
      console.log(base64ToUint8(placeholder),'base64ToUint8(placeholder)')
      placeholderDSL = decompressDSL(base64ToUint8(placeholder));
      console.log(placeholderDSL,'placeholderDSL')
      cacheSize = {
        width: placeholderDSL?.width,
        height: placeholderDSL?.height,
      };
    }
  } catch (e) {
    console.error("读取缓存尺寸失败", e);
  }

  const [dslCache, setDslCache] = useState<SkeletonDSL | null>(() => {
    if (!hasCache && placeholderDSL) {
      return placeholderDSL;
    }
    return null;
  });

  const [sizes] = useState<{ width: string; height: string }>(() => {
    if (hasCache||placeholderDSL) {
      return cacheSize;
    } 
    return { width: "auto", height: "auto" };
  });

  const instance = useRef<generateSkeleton>(null);
  const timeoutRef = useRef<number>(null);
  console.log(others, "others");

  // 读取缓存 DSL
  useEffect(() => {
    async function fetchCache() {
      try {
        const value: any = await getItem(key);
        if (value) {
          const dsl = value;
          setDslCache(dsl);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchCache();
  }, []);

  // 延迟初始化骨架生成
  useEffect(() => {
    if (loading) return;

    timeoutRef.current = window.setTimeout(() => {
      const root = document.getElementById(id);
      if (!root) return;

      instance.current = new generateSkeleton({ root, id, ...others });
      instance.current.performWorkUnit();
    }, delayTime);

    return () => {
      instance.current?.cancelTask();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [loading]);
  console.log(dslCache, "dsl");
  return (
    <div
      className={`ske-wrap ${loading ? "loading" : "loaded"} ${
        loading && (sizes?.width != "auto" )
          ? "loadingWithCache"
          : ""
      }`}
      style={{
        position: "relative",
        width: loading ? sizes?.width : "auto",
        height: loading ? sizes?.height : "auto",
        background:
          loading && (sizes?.width != "auto" )
            ? background
            : "transparent",
      }}
    >
      {/* DSL 渲染 */}
      {loading && dslCache && renderDSLToDOM(dslCache)}

      {/* 真正的 DOM */}
      <div id={id} className="ske-real-dom">
        {children}
      </div>
    </div>
  );
};

export default SmartySkeleton;
