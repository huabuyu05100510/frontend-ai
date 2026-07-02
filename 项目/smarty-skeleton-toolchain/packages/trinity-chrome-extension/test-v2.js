// 测试 SkeletonTranspiler v2
const fs = require('fs');

// 模拟浏览器环境
const mockDocument = {
  body: {
    tagName: 'BODY',
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    children: [
      {
        tagName: 'DIV',
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
        children: [
          {
            tagName: 'H1',
            getBoundingClientRect: () => ({ left: 50, top: 50, width: 500, height: 40 }),
            childNodes: [{ nodeType: 3, textContent: 'Hello World' }],
            children: []
          },
          {
            tagName: 'DIV',
            getBoundingClientRect: () => ({ left: 50, top: 110, width: 300, height: 100 }),
            style: { display: 'flex', gap: '10px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' },
            children: [
              {
                tagName: 'BUTTON',
                getBoundingClientRect: () => ({ left: 50, top: 110, width: 100, height: 44 }),
                childNodes: [{ nodeType: 3, textContent: 'Click' }],
                children: []
              },
              {
                tagName: 'BUTTON',
                getBoundingClientRect: () => ({ left: 160, top: 110, width: 100, height: 44 }),
                childNodes: [{ nodeType: 3, textContent: 'Reset' }],
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
};

// 加载 SkeletonTranspiler
const code = fs.readFileSync('./src/skeleton-transpiler.js', 'utf8');
eval(code);

// 创建模拟 window/document
global.window = {
  getComputedStyle: (el) => {
    const style = el.style || {};
    return {
      display: style.display || 'block',
      position: 'static',
      flexDirection: 'row',
      flexWrap: 'nowrap',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      gap: 'normal',
      gridTemplateColumns: 'none',
      gridTemplateRows: 'none',
      marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
      paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
      zIndex: 'auto',
      lineHeight: '14',
      fontSize: '14',
      ...style
    };
  }
};

global.document = mockDocument;
global.Node = { TEXT_NODE: 3 };

const transpiler = new SkeletonTranspiler({ preserveLayout: true });
const result = transpiler.transpile(mockDocument.body);

console.log('=== Stats ===');
console.log(JSON.stringify(result.stats, null, 2));

console.log('\n=== Generated Code ===');
console.log(result.code || '(empty)');

console.log('\n=== Anchor Count ===');
console.log('Anchors:', result.anchors.length);
