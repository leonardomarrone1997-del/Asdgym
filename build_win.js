// node build_win.js              copies the shared logic and style into win/web, then builds win/build/GymArtSegreteria.exe
// node build_win.js --solo-copia only refreshes the copies (enough before `go test` or a development build)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = __dirname, web = path.join(root, 'win', 'web');
for (const f of ['core.js', 'style.css']) fs.copyFileSync(path.join(root, 'src', f), path.join(web, f));
console.log('copied src/core.js and src/style.css into win/web');
if (!process.argv.includes('--solo-copia')) {
  fs.mkdirSync(path.join(root, 'win', 'build'), { recursive: true });
  // windowsgui: no console window behind the program
  execFileSync('go', ['build', '-trimpath', '-ldflags', '-H=windowsgui -s -w', '-o', path.join('build', 'GymArtSegreteria.exe'), '.'],
    { cwd: path.join(root, 'win'), env: Object.assign({}, process.env, { GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }), stdio: 'inherit' });
  console.log('built win/build/GymArtSegreteria.exe', fs.statSync(path.join(root, 'win', 'build', 'GymArtSegreteria.exe')).size);
}
