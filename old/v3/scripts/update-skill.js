import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sources = [
  {
    from: path.resolve(__dirname, '../../Punch-UI/skills/punch-ui'),
    to: path.resolve(__dirname, '../skills/punch-ui')
  },
  {
    from: path.resolve(__dirname, '../../ofa.js/skills/ofajs-docs'),
    to: path.resolve(__dirname, '../skills/ofajs-docs')
  }
];

function copyDirectorySync(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`源目录不存在: ${src}`);
    return false;
  }

  if (fs.existsSync(dest)) {
    console.log(`删除已存在的目录: ${dest}`);
    fs.rmSync(dest, { recursive: true, force: true });
  }

  console.log(`拷贝目录: ${src} -> ${dest}`);
  fs.cpSync(src, dest, { recursive: true });
  console.log(`✓ 完成: ${dest}`);
  return true;
}

function main() {
  console.log('开始更新 skills 目录...\n');
  
  let successCount = 0;
  let failCount = 0;

  sources.forEach(({ from, to }) => {
    const success = copyDirectorySync(from, to);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  });

  console.log('\n更新完成!');
  console.log(`成功: ${successCount} 个`);
  console.log(`失败: ${failCount} 个`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
