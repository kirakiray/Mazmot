import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }

  return fileList;
}

function processDirectory(sourceDir, outputFile) {
  const subdirs = fs.readdirSync(sourceDir).filter(item => {
    return fs.statSync(path.join(sourceDir, item)).isDirectory();
  });

  const result = {};

  for (const subdir of subdirs) {
    const subdirPath = path.join(sourceDir, subdir);
    const files = getAllFiles(subdirPath);

    result[subdir] = {};

    for (const file of files) {
      const relativePath = path.relative(subdirPath, file);
      const content = fs.readFileSync(file, 'utf-8');
      result[subdir][relativePath] = { text: content };
    }
  }

  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Written to ${outputFile}`);
}

const capabilitiesDir = path.resolve(__dirname, '../capabilities');
const outputCapabilities = path.resolve(__dirname, '../dist/capabilities.json');
processDirectory(capabilitiesDir, outputCapabilities);

const skillsDir = path.resolve(__dirname, '../skills');
const outputSkills = path.resolve(__dirname, '../dist/skills.json');
processDirectory(skillsDir, outputSkills);
