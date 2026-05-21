# 能力测试

用于检测能力是否可用的能力。

有时候情况下，AI调用能力没有得到想要的结果，这时候可能某个能力出错了，就需要能力测试工具来判断特定的能力是否可用，确保能够不是能力出问题导致流程中断。

每个能力包基本会带上测试案例，直接测试能力包是否有报错，就能快速知道能力包是否可用。

## 使用方法

<cap-request>
    <template name="test-cap" cid="test-cap-01" desc="测试能力是否可用" data-capability="run-js"></template>
</cap-request>

这个是调用能力测试，测试 run-js 能力是否可用。而 run-js 能力顶部会配置对应的测试文件，这时候这个能力测试就能调用对应测试文件，去测试 run-js 能力是否可用。

如果 run-js 能力测试通过，就会返回一个数组，对象内的 assert 为 true 数组字符串。

<cap-response>
    <template result name="test-cap" cid="test-cap-01">
        [{"assert": true, "content": "some result content"},{"assert": true, "content": "some result content"}]
    </template>
</cap-response>

如果 run-js 能力测试不通过，也是会返回一个数组，对象内的 assert 为 false 数组字符串。

<cap-response>
    <template error name="test-cap" cid="test-cap-01">
        [{"assert": false, "content": "some error content"}]
    </template>
</cap-response>
