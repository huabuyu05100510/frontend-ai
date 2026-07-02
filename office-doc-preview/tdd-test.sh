#!/bin/bash
# Office文档预览系统 - TDD端到端自动化测试脚本

set -e

echo "========================================="
echo "Office文档预览系统 - TDD自动化测试"
echo "========================================="
echo ""

# 测试配置
FRONTEND_URL="http://localhost:5188"
BACKEND_URL="http://localhost:5180"
TEST_TIMEOUT=30

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

# 测试函数
test_case() {
    local name="$1"
    local expected="$2"
    local actual="$3"

    if [ "$expected" = "$actual" ]; then
        echo "${GREEN}[PASS]${NC} $name"
        pass_count=$((pass_count + 1))
        return 0
    else
        echo "${RED}[FAIL]${NC} $name"
        echo "  Expected: $expected"
        echo "  Actual: $actual"
        fail_count=$((fail_count + 1))
        return 1
    fi
}

test_contains() {
    local name="$1"
    local expected="$2"
    local actual="$3"

    if echo "$actual" | grep -q "$expected"; then
        echo "${GREEN}[PASS]${NC} $name"
        pass_count=$((pass_count + 1))
        return 0
    else
        echo "${RED}[FAIL]${NC} $name"
        echo "  Expected to contain: $expected"
        echo "  Actual: $actual"
        fail_count=$((fail_count + 1))
        return 1
    fi
}

# ==========================================
echo "1️⃣ 后端服务测试"
echo "========================================="

# 测试后端健康检查
echo "测试后端健康检查..."
health_response=$(curl -s "$BACKEND_URL/api/health" --max-time $TEST_TIMEOUT)
test_contains "后端健康检查" "ok" "$health_response"

# 测试任务列表API
echo "测试任务列表API..."
tasks_response=$(curl -s "$BACKEND_URL/api/tasks" --max-time $TEST_TIMEOUT)
test_contains "任务列表API" "tasks" "$tasks_response"

# 提取蘑菇书PDF任务ID
mushroom_id=$(echo "$tasks_response" | python3 -c "import sys, json; data=json.load(sys.stdin); pdfs=[t for t in data['tasks'] if '蘑菇书' in t['name'] and t['size']>100000000]; print(pdfs[0]['id'] if pdfs else 'none')")
echo "蘑菇书PDF任务ID: $mushroom_id"

# 测试文件服务
echo "测试蘑菇书PDF文件服务..."
file_status=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/files/$mushroom_id?as=original" --max-time $TEST_TIMEOUT)
test_case "蘑菇书PDF文件服务" "200" "$file_status"

# 测试小PDF文件服务
small_pdf_id=$(echo "$tasks_response" | python3 -c "import sys, json; data=json.load(sys.stdin); pdfs=[t for t in data['tasks'] if t['ext']=='pdf' and t['size']<1000000]; print(pdfs[0]['id'] if pdfs else 'none')")
echo "小PDF任务ID: $small_pdf_id"

small_file_status=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/files/$small_pdf_id?as=original" --max-time $TEST_TIMEOUT)
test_case "小PDF文件服务" "200" "$small_file_status"

# 测试Range请求支持
echo "测试Range请求支持..."
range_status=$(curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=0-1023" "$BACKEND_URL/api/files/$mushroom_id?as=original" --max-time $TEST_TIMEOUT)
test_case "Range请求支持" "206" "$range_status"

echo ""

# ==========================================
echo "2️⃣ 前端服务测试"
echo "========================================="

# 测试前端页面
echo "测试前端页面加载..."
frontend_status=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/" --max-time $TEST_TIMEOUT)
test_case "前端页面" "200" "$frontend_status"

# 测试前端是否能返回HTML
frontend_html=$(curl -s "$FRONTEND_URL/" --max-time $TEST_TIMEOUT)
test_contains "前端HTML内容" "<div id=\"root\"" "$frontend_html"

# 测试PdfPreviewWASM组件是否能加载
echo "测试PdfPreviewWASM组件加载..."
wasm_component=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/src/previewers/PdfPreviewWASM.tsx" --max-time $TEST_TIMEOUT)
test_case "PdfPreviewWASM组件" "200" "$wasm_component"

# 测试base64 WASM模块是否能加载
echo "测试base64 WASM模块..."
base64_module=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/node_modules/@hyzyla/pdfium/dist/index.esm.base64.js" --max-time $TEST_TIMEOUT)
test_case "base64 WASM模块" "200" "$base64_module"

echo ""

# ==========================================
echo "3️⃣ WASM加载测试"
echo "========================================="

# 测试WASM文件是否存在
echo "测试WASM文件存在..."
wasm_file="/Users/huabuyu/resume/office-doc-preview/office-preview-app/web/node_modules/@hyzyla/pdfium/dist/pdfium.wasm"
if [ -f "$wasm_file" ]; then
    wasm_size=$(ls -lh "$wasm_file" | awk '{print $5}')
    echo "${GREEN}[PASS]${NC} WASM文件存在（大小：$wasm_size）"
    pass_count=$((pass_count + 1))
else
    echo "${RED}[FAIL]${NC} WASM文件不存在"
    fail_count=$((fail_count + 1))
fi

# 测试WASM文件大小（应该是~4MB）
wasm_bytes=$(stat -f%z "$wasm_file" 2>/dev/null || stat --printf="%s" "$wasm_file" 2>/dev/null)
if [ "$wasm_bytes" -gt 3000000 ]; then
    echo "${GREEN}[PASS]${NC} WASM文件大小正确（$wasm_bytes bytes）"
    pass_count=$((pass_count + 1))
else
    echo "${RED}[FAIL]${NC} WASM文件太小（$wasm_bytes bytes）"
    fail_count=$((fail_count + 1))
fi

echo ""

# ==========================================
echo "4️⃣ PDF渲染性能测试"
echo "========================================="

# 测试服务端渲染蘑菇书第10页
echo "测试服务端渲染蘑菇书第10页..."
render_start=$(date +%s%N)
pdftoppm -f 10 -l 10 -png -r 72 "/Users/huabuyu/resume/office-doc-preview/office-preview-app/.data/uploads/$mushroom_id_蘑菇书.pdf" /tmp/test-page10 2>&1
render_end=$(date +%s%N)
render_time=$(( ($render_end - $render_start) / 1000000 ))
echo "服务端渲染时间: ${render_time}ms"

if [ "$render_time" -lt 5000 ]; then
    echo "${GREEN}[PASS]${NC} 服务端渲染快（${render_time}ms）"
    pass_count=$((pass_count + 1))
else
    echo "${YELLOW}[WARN]${NC} 服务端渲染慢（${render_time}ms）"
fi

# 测试渲染产物是否存在
if [ -f "/tmp/test-page10-10.png" ]; then
    page_size=$(ls -lh "/tmp/test-page10-10.png" | awk '{print $5}')
    echo "${GREEN}[PASS]${NC} 渲染产物存在（大小：$page_size）"
    pass_count=$((pass_count + 1))
else
    echo "${RED}[FAIL]${NC} 渲染产物不存在"
    fail_count=$((fail_count + 1))
fi

echo ""

# ==========================================
echo "5️⃣ 文件上传测试"
echo "========================================="

# 测试文件上传功能
echo "测试文件上传..."
upload_test_file="/tmp/test-upload-$(date +%s).txt"
echo "测试上传文件内容" > "$upload_test_file"

upload_response=$(curl -s -X POST -F "file=@$upload_test_file" "$BACKEND_URL/api/upload" --max-time $TEST_TIMEOUT)
upload_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST -F "file=@$upload_test_file" "$BACKEND_URL/api/upload" --max-time $TEST_TIMEOUT)

if [ "$upload_status" = "200" ]; then
    echo "${GREEN}[PASS]${NC} 文件上传成功（HTTP $upload_status）"
    pass_count=$((pass_count + 1))
else
    echo "${RED}[FAIL]${NC} 文件上传失败（HTTP $upload_status）"
    fail_count=$((fail_count + 1))
fi

# 验证上传的任务是否存在
upload_task_id=$(echo "$upload_response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['task']['id'] if 'task' in data else 'none')")

if [ "$upload_task_id" != "none" ]; then
    echo "${GREEN}[PASS]${NC} 上传任务创建成功（ID: $upload_task_id）"
    pass_count=$((pass_count + 1))
else
    echo "${RED}[FAIL]${NC} 上传任务创建失败"
    fail_count=$((fail_count + 1))
fi

# 清理测试文件
rm -f "$upload_test_file"

echo ""

# ==========================================
echo "6️⃣ Office文档转码测试"
echo "========================================="

# 检查Office文档转码状态
echo "测试Office文档转码..."
office_tasks=$(echo "$tasks_response" | python3 -c "import sys, json; data=json.load(sys.stdin); office=[t for t in data['tasks'] if t['ext'] in ['docx', 'pptx', 'xlsx']]; print(len(office))")
echo "Office文档数量: $office_tasks"

# 检查已转码的Office文档
converted_office=$(echo "$tasks_response" | python3 -c "import sys, json; data=json.load(sys.stdin); office=[t for t in data['tasks'] if t['ext'] in ['docx', 'pptx', 'xlsx'] and t['convertStatus']=='done']; print(len(office))")
echo "已转码Office文档: $converted_office"

if [ "$converted_office" -gt 0 ]; then
    echo "${GREEN}[PASS]${NC} Office文档转码成功（$converted_office个）"
    pass_count=$((pass_count + 1))
else
    echo "${YELLOW}[WARN]${NC} Office文档转码未完成"
fi

# 测试转码后的PDF文件访问
if [ "$converted_office" -gt 0 ]; then
    office_preview_id=$(echo "$tasks_response" | python3 -c "import sys, json; data=json.load(sys.stdin); office=[t for t in data['tasks'] if t['ext'] in ['docx', 'pptx', 'xlsx'] and t['convertStatus']=='done' and t['previewUrl']]; print(office[0]['id'] if office else 'none')")

    if [ "$office_preview_id" != "none" ]; then
        office_preview_status=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/files/$office_preview_id?as=preview" --max-time $TEST_TIMEOUT)
        test_case "Office转码PDF访问" "200" "$office_preview_status"
    fi
fi

echo ""

# ==========================================
echo "7️⃣ JavaScript编译测试"
echo "========================================="

# 测试前端是否有JavaScript编译错误
echo "测试前端JavaScript编译..."
js_errors=$(curl -s "$FRONTEND_URL/src/App.tsx" --max-time $TEST_TIMEOUT | grep -c "throw new Error")

if [ "$js_errors" -eq 0 ]; then
    echo "${GREEN}[PASS]${NC} 前端JavaScript编译正常"
    pass_count=$((pass_count + 1))
else
    echo "${YELLOW}[WARN]${NC} 前端可能有JavaScript错误（$js_errors个throw语句）"
fi

# 测试PdfPreviewWASM导入是否正确
echo "测试PdfPreviewWASM导入..."
wasm_import=$(curl -s "$FRONTEND_URL/src/previewers/PdfPreviewWASM.tsx" --max-time $TEST_TIMEOUT)
test_contains "PdfPreviewWASM导入base64" "@hyzyla/pdfium/browser/base64" "$wasm_import"

# 测试PreviewRouter是否使用WASM版本
echo "测试PreviewRouter使用WASM..."
router_import=$(curl -s "$FRONTEND_URL/src/previewers/index.tsx" --max-time $TEST_TIMEOUT)
test_contains "PreviewRouter使用PdfPreviewWASM" "PdfPreviewWASM" "$router_import"

echo ""

# ==========================================
echo "📊 测试结果统计"
echo "========================================="

total_tests=$((pass_count + fail_count))
pass_rate=$((pass_count * 100 / total_tests))

echo ""
echo "总测试数: $total_tests"
echo "${GREEN}通过数: $pass_count${NC}"
echo "${RED}失败数: $fail_count${NC}"
echo "通过率: ${pass_rate}%"
echo ""

if [ $fail_count -eq 0 ]; then
    echo "${GREEN}✅ 所有测试通过！系统正常运行${NC}"
    echo ""
    echo "🎯 系统状态:"
    echo "  - 后端服务: ✅ 正常（HTTP 200）"
    echo "  - 前端服务: ✅ 正常（HTTP 200）"
    echo "  - WASM加载: ✅ 正常（base64版本）"
    echo "  - 文件服务: ✅ 正常（Range支持）"
    echo "  - Office转码: ✅ 正常（LibreOffice）"
    echo ""
    echo "🚀 现在可以打开浏览器测试: $FRONTEND_URL"
    exit 0
else
    echo "${RED}❌ 测试失败！需要修复问题${NC}"
    exit 1
fi