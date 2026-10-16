const path = require('node:path');
const fs = require('node:fs');
const { packager } = require('@electron/packager');
const metadata = require('../package.json');
(async () => {
  let staging=false,electronZipDir;
  const args=process.argv.slice(2);for(let i=0;i<args.length;i++){if(args[i]==='--staging')staging=true;else if(args[i]==='--electron-zip-dir'){const directory=args[++i];if(!directory||directory.startsWith('--'))throw Error('Select a directory containing the official cached Electron ZIP.');electronZipDir=path.resolve(directory);const file=path.join(electronZipDir,`electron-v${metadata.devDependencies.electron}-${process.platform}-${process.arch}.zip`);if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('Cached Electron ZIP for this version, OS and CPU was not found.');}else throw Error('Supported options: --staging, --electron-zip-dir <directory>.');}
  const paths = await packager({
    dir: path.join(__dirname, '..'),
    out: path.join(__dirname, '..', 'dist', ...(staging ? ['staging'] : [])),
    ...(electronZipDir?{electronZipDir}:{}),
    name: 'OnggiBot',
    executableName: 'OnggiBot',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'darwin' ? 'icon.icns' : process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    platform: process.platform,
    arch: process.arch,
    overwrite: true,
    asar: { unpack: '**/src/store*.cjs' },
    afterPrune: [({ buildPath }) => {
      const file = path.join(buildPath, 'package.json');
      const packaged = JSON.parse(fs.readFileSync(file, 'utf8'));
      packaged.onggiProjectVersion = metadata.version;
      fs.writeFileSync(file, JSON.stringify(packaged, null, 2));
    }],
    appBundleId: 'local.onggibot.desktop',
    appCategoryType: 'public.app-category.productivity',
    appVersion: '0.1.0',
    buildVersion: '38',
    ...(process.platform==='darwin'?{osxSign:{identity:'-',identityValidation:false,type:'development',preAutoEntitlements:false,preEmbedProvisioningProfile:false,optionsForFile:()=>({entitlements:['com.apple.security.cs.allow-jit'],hardenedRuntime:false})}}:{}),
    electronVersion: metadata.devDependencies.electron,
    prune: true,
    ignore: [/^\/node_modules(?:\/|$)/, /^\/artifacts(?:\/|$)/, /^\/dist(?:\/|$)/, /^\/test(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/package-lock\.json$/, /^\/eslint\.config\.cjs$/, /^\/(?:README|TASKS|AGENTS)\.md$/, /^\/\.gitignore$/, /^\/src\/ui\/renderer\.mjs$/, /^\/assets\/tray-source\.png$/],
  });
  console.log(paths.join('\n'));
})().catch(error => { console.error(error); process.exit(1); });
