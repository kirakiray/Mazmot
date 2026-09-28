/**
 * SW / Core 调试开关（唯一的本地调试切换点）
 *
 * coreDev: false（默认）—— SW 与 nos-version 组件一律走线上 core.noneos.com。
 * coreDev: true  且页面跑在 localhost 时——SW importScripts 本地
 *            http://localhost:3002/sw/dist.js（未启动则回退线上），index.html
 *            同步加载本地 3002 的 nos-version 组件。
 * 非 localhost 环境无论取值如何都走线上；提交前记得改回 false。
 */
globalThis.SW_CONFIG = { coreDev: false };
