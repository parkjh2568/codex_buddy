const path = require('node:path');
const fs = require('node:fs');
const { packager } = require('@electron/packager');
const metadata = require('../package.json');
(async () => {
  if(process.argv.slice(2).some(argument=>argument!=='--staging'))throw Error('Supported option: --staging. The target uses the current OS and CPU.');
  const paths = await packager({
    dir: path.join(__dirname, '..'),
    out: path.join(__dirname, '..', 'dist', ...(process.argv.includes('--staging') ? ['staging'] : [])),
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
    buildVersion: '30',
    electronVersion: metadata.devDependencies.electron,
    prune: true,
    ignore: [/^\/node_modules(?:\/|$)/, /^\/artifacts(?:\/|$)/, /^\/dist(?:\/|$)/, /^\/test(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/package-lock\.json$/, /^\/eslint\.config\.cjs$/, /^\/(?:README|TASKS|AGENTS)\.md$/, /^\/\.gitignore$/, /^\/src\/ui\/renderer\.mjs$/, /^\/assets\/tray-source\.png$/],
  });
  console.log(paths.join('\n'));
})().catch(error => { console.error(error); process.exit(1); });
