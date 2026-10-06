const path = require('node:path');
const { packager } = require('@electron/packager');
(async () => {
  const paths = await packager({ dir: path.join(__dirname,'..'), out: path.join(__dirname,'..','dist'), name:'OnggiBot', executableName:'OnggiBot', icon:path.join(__dirname,'..','assets',process.platform === 'darwin' ? 'icon.icns' : process.platform === 'win32' ? 'icon.ico' : 'icon.png'), platform:process.platform, arch:process.arch, overwrite:true, asar:true, appBundleId:'local.onggibot.desktop', appCategoryType:'public.app-category.productivity', appVersion:'0.1.0', buildVersion:'14', electronVersion:require('../package.json').devDependencies.electron, prune:true, ignore: [/^\/node_modules(?:\/|$)/,/^\/artifacts(?:\/|$)/,/^\/dist(?:\/|$)/,/^\/test(?:\/|$)/,/^\/scripts(?:\/|$)/,/^\/docs(?:\/|$)/,/^\/\.git(?:\/|$)/,/^\/package-lock\.json$/] });
  console.log(paths.join('\n'));
})().catch(error => { console.error(error); process.exit(1); });
