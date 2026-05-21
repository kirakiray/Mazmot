---
name: test-cap
description: 用于测试其他能力是否可用的能力测试工具
page: src/test-cap.html
test: test/index.html
---

# 能力测试

用于检测指定能力是否可用的工具。

当 AI 调用能力后未得到预期结果时，可使用此工具验证特定能力是否正常工作，确保问题根源并非能力本身故障。

每个能力包通常附带测试案例，直接运行测试可快速判断能力包是否可用。

## 使用方法

<cap-request>
    <template name="test-cap" cid="test-cap-01" desc="测试能力是否可用" data-capability="run-js"></template>
</cap-request>

通过 `data-capability` 参数指定要测试的能力名称（此处为 `run-js`）。系统会根据目标能力配置的测试文件，自动执行相应的测试用例。

测试通过时，返回结果数组中每个对象的 `assert` 属性为 `true`：

<cap-response>
    <template result name="test-cap" cid="test-cap-01">
        [{"assert": true, "desc": "测试 run-js 能力1", "content": "测试的返回结果1"},{"assert": true, "desc": "测试 run-js 能力2", "content": "测试的返回结果2"},...]
    </template>
</cap-response>

测试失败时，返回结果数组中如果包含了 `assert` 为 `false` 的对象，说明某个测试用例执行失败：

<cap-response>
    <template error name="test-cap" cid="test-cap-01">
        [{"assert": false, "desc": "测试 run-js 能力", "content": "测试的返回结果"},...]
    </template>
</cap-response>

若测试失败，则表明该能力可能因故障而无法正常使用。
