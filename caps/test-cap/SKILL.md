---
name: test-cap
description: 每个能力都自带测试用例。当某个能力反复调用失败且查阅文档后仍无法解决时，可使用 test-cap 能力验证该能力是否正常工作，快速定位问题根源。
page: src/test-cap-dialogue.html
test: test/index.html
---

# 能力测试

用于检测指定能力是否可用的诊断工具。当 AI 调用能力后未得到预期结果时，可通过此工具验证能力本身是否正常工作，快速排查问题根源。

## 使用方法

<cap-request>
    <template name="test-cap" cid="test-cap-01" desc="测试能力是否可用" data-capability="run-js"></template>
</cap-request>

通过 `data-capability` 参数指定要测试的能力名称（如 `run-js`），系统将自动执行该能力配置的测试用例。

### 测试结果

**成功示例** - 所有测试用例的 `assert` 属性均为 `true`：

<cap-response>
    <template result name="test-cap" cid="test-cap-01">
        [{"assert": true, "desc": "测试 run-js 能力1", "content": "测试的返回结果1"},{"assert": true, "desc": "测试 run-js 能力2", "content": "测试的返回结果2"},...]
    </template>
</cap-response>

**失败示例** - 存在 `assert` 为 `false` 的测试用例：

<cap-response>
    <template error name="test-cap" cid="test-cap-01">
        [{"assert": false, "desc": "测试 run-js 能力", "content": "测试的返回结果"},...]
    </template>
</cap-response>

测试失败表明该能力可能存在故障，无法正常使用。
