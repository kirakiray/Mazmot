// 每轮 Playwright 运行前清掉上轮残留数据，保证用例可重复执行
import { rmSync } from "node:fs";

export default () => {
  rmSync(new URL("../data/e2e-ui.redb", import.meta.url), { force: true });
  rmSync(new URL("../data/e2e-ui.redb-shm", import.meta.url), { force: true });
  rmSync(new URL("../data/e2e-ui.redb-wal", import.meta.url), { force: true });
};
