import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置：要处理的目录和对应的输出文件
const config = {
  tempFile: {
    baseDir: path.join(__dirname, '../pages/create-app/util/temp-file/base'),
    outputFile: path.join(__dirname, '../pages/create-app/util/temp-file/base/__files.json')
  }
};

// 递归遍历目录获取所有文件
function getAllFiles(dirPath, basePath = '') {
  const files = [];
  const items = fs.readdirSync(dirPath);

  items.forEach(item => {
    // 跳过隐藏文件和 __files.json
    if (item.startsWith('.') || item === '__files.json') {
      return;
    }

    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // 递归处理子目录
      const subFiles = getAllFiles(fullPath, path.join(basePath, item));
      files.push(...subFiles);
    } else {
      // 添加文件的相对路径
      const relativePath = path.join(basePath, item);
      files.push(relativePath);
    }
  });

  return files;
}

// 更新指定目录的 __files.json
function updateFilesJson(key) {
  const { baseDir, outputFile } = config[key];

  if (!fs.existsSync(baseDir)) {
    console.error(`Directory not found: ${baseDir}`);
    return;
  }

  // 获取所有文件
  const allFiles = getAllFiles(baseDir);

  // 更新 __files.json
  const fileData = {
    files: allFiles
  };

  fs.writeFileSync(outputFile, JSON.stringify(fileData, null, 2), 'utf-8');

  console.log(`Updated ${outputFile}`);
  console.log('Files:', allFiles);
}

// 从命令行参数获取要处理的配置键
const key = process.argv[2] || 'tempFile';

if (config[key]) {
  updateFilesJson(key);
} else {
  console.error(`Unknown config key: ${key}`);
  console.log('Available keys:', Object.keys(config).join(', '));
}