const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron } = require('playwright');
const { extractFile } = require('@electron/asar');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '..');
const testName = 'MedoMusic Upgrade Test';
const testGuid = '6a82de3b-a1c1-4c16-8428-dd0e3b093204';
const packageName = 'medo-installer-upgrade-test';
const artifacts = path.join(root, 'tests', 'artifacts', 'installer-upgrade');
const base = process.argv[2] ? path.resolve(process.argv[2]) : path.join(artifacts, `run-${Date.now()}`);
assert.ok(base.startsWith(artifacts + path.sep), 'Fixture output must stay inside the installer test directory');
const profile = path.join(base, 'Profile');
const installed = path.join(base, '旧版 安装');
const relocated = path.join(base, '新版 安装');
const portable = path.join(base, 'portable-old');
const cases = [];
const applications = [];
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;

async function powershell(code, values = {}) {
  const {stdout} = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n' + code], {
    cwd:root, env:{...env, MEDO_UPGRADE_TEST_NAME:testName, MEDO_UPGRADE_TEST_GUID:testGuid, ...values},
    windowsHide:true, maxBuffer:1024 * 1024
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
async function links(name = testName) {
  return powershell(`
    $w = New-Object -ComObject WScript.Shell
    $locations = @([Environment]::GetFolderPath('Desktop'), [IO.Path]::Combine([Environment]::GetFolderPath('StartMenu'), 'Programs'))
    $links = @($locations | ForEach-Object {
      $linkPath = [IO.Path]::Combine($_, $env:MEDO_UPGRADE_LINK_NAME + '.lnk')
      if (Test-Path -LiteralPath $linkPath) {
        $link = $w.CreateShortcut($linkPath)
        @{path=$linkPath;target=$link.TargetPath;arguments=$link.Arguments}
      }
    })
    ConvertTo-Json -InputObject $links -Compress
  `, {MEDO_UPGRADE_LINK_NAME:name});
}
async function registration() {
  return powershell(`
    $p = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + $env:MEDO_UPGRADE_TEST_GUID
    if (Test-Path -LiteralPath $p) {
      $v = Get-ItemProperty -LiteralPath $p
      @{version=$v.DisplayVersion;uninstall=$v.UninstallString} | ConvertTo-Json -Compress
    }
  `);
}
async function rewriteLinks(target) {
  await powershell(`
    $w = New-Object -ComObject WScript.Shell
    $locations = @([Environment]::GetFolderPath('Desktop'), [IO.Path]::Combine([Environment]::GetFolderPath('StartMenu'), 'Programs'))
    foreach ($directory in $locations) {
      $p = [IO.Path]::Combine($directory, $env:MEDO_UPGRADE_TEST_NAME + '.lnk')
      if (Test-Path -LiteralPath $p) {
        $link = $w.CreateShortcut($p)
        $link.TargetPath = $env:MEDO_UPGRADE_LINK_TARGET
        $link.Arguments = '--user-data-dir="' + $env:MEDO_UPGRADE_PROFILE + '"'
        $link.Save()
      }
    }
  `, {MEDO_UPGRADE_LINK_TARGET:target, MEDO_UPGRADE_PROFILE:profile});
}
async function build(version, fixed) {
  const directory = path.join(base, fixed ? 'fixed-build' : 'baseline-build');
  const fixture = {installer:path.join(directory, `Fixture-${version}.exe`), unpacked:path.join(directory, 'win-unpacked')};
  if (process.argv[2]) {
    assert.ok(fs.existsSync(fixture.installer));
    assert.equal(installedVersion(fixture.unpacked), version);
    assert.ok(extractFile(path.join(fixture.unpacked, 'resources', 'app.asar'), 'src/main.js').equals(fs.readFileSync(path.join(root, 'src', 'main.js'))));
    return fixture;
  }
  const configuration = structuredClone(require('../package.json').build);
  configuration.appId = 'com.medomusic.installer-upgrade-test';
  configuration.productName = testName;
  configuration.electronDist = path.join(root, '.electron-dist');
  configuration.directories.output = directory;
  configuration.fileAssociations = [];
  configuration.extraMetadata = {name:packageName, version};
  configuration.nsis = {...configuration.nsis, guid:testGuid, shortcutName:testName,
    artifactName:'Fixture-${version}.exe',
    include:fixed ? path.join(root, 'build', 'installer.nsh') : path.join(base, 'baseline.nsh')};
  const configurationPath = path.join(base, fixed ? 'fixed.json' : 'baseline.json');
  fs.writeFileSync(configurationPath, JSON.stringify(configuration, null, 2));
  console.log(`Preparing ${fixed ? 'fixed' : 'baseline'} installer ${version}`);
  const result = await execute(process.execPath, [
    path.join(root, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--x64',
    `--config=${configurationPath}`, '--publish', 'never'
  ], {cwd:root, env, windowsHide:true, maxBuffer:4 * 1024 * 1024});
  fs.writeFileSync(path.join(base, `${fixed ? 'fixed' : 'baseline'}-build.log`), result.stdout + result.stderr);
  return fixture;
}
async function install(installer, destination, update = false) {
  assert.ok(path.resolve(destination).startsWith(base + path.sep));
  await execute(installer, ['/S', '/currentuser', ...(update ? ['--updated'] : []), `/D=${destination}`], {
    cwd:base, env, windowsHide:true, timeout:90000
  });
}
function installedVersion(directory) {
  return JSON.parse(extractFile(path.join(directory, 'resources', 'app.asar'), 'package.json').toString()).version;
}
async function launch(directory) {
  const application = await _electron.launch({
    executablePath:path.join(directory, `${testName}.exe`), args:[`--user-data-dir=${profile}`], cwd:directory, env
  });
  const launchedProcess = application.process();
  applications.push({application,process:launchedProcess});
  await application.evaluate(({app}, musicDirectory) => app.setPath('music', musicDirectory), path.join(profile, 'Music'));
  const page = await application.firstWindow();
  await page.waitForFunction(() => typeof autoCheckUpdates === 'boolean');
  await page.evaluate(() => {
    localStorage.setItem('medo.initialScanComplete', 'true');
    localStorage.setItem('medo.autoCheckUpdates', 'false');
    document.querySelector('#settings-button').click();
  });
  return {application,page,process:launchedProcess};
}
async function checkUpdated(directory, fixture) {
  assert.equal(installedVersion(directory), '1.6.2');
  const actual = await links();
  assert.equal(actual.length, 2);
  for (const link of actual) {
    assert.equal(link.target.toLowerCase(), path.join(directory, `${testName}.exe`).toLowerCase());
    assert.equal(link.arguments, '', 'Old custom launch arguments must not survive the shortcut refresh');
  }
  assert.equal((await registration()).version, '1.6.2');
  assert.ok((await registration()).uninstall.includes(directory));
  assert.ok(extractFile(path.join(directory, 'resources', 'app.asar'), 'src/main.js')
    .equals(extractFile(path.join(fixture.unpacked, 'resources', 'app.asar'), 'src/main.js')));
  const running = await launch(directory);
  const info = await running.page.evaluate(() => window.medo.getAppInfo());
  assert.equal(info.version, '1.6.2');
  assert.equal(info.installDirectory.toLowerCase(), directory.toLowerCase());
  assert.equal(await running.page.evaluate(() => localStorage.getItem('medo.upgradeFixture')), 'preserved');
  await running.page.waitForFunction(expected => document.querySelector('#about-version').textContent === expected, `${info.name} 1.6.2`);
  assert.equal(await running.page.locator('#about-version').textContent(), `${info.name} 1.6.2`);
  assert.equal((await running.page.locator('#about-install-directory').textContent()).toLowerCase(), directory.toLowerCase());
  return running;
}
async function run() {
  fs.mkdirSync(base, {recursive:true});
  fs.mkdirSync(path.join(profile, 'Music'), {recursive:true});
  fs.writeFileSync(path.join(base, 'baseline.nsh'), '; Original installer without upgrade fixes.\n');
  assert.equal(await registration(), null, 'Refuse to overwrite an existing test registration');
  assert.deepEqual(await links(), [], 'Refuse to overwrite existing test shortcuts');
  const realLinksBefore = await links('MedoMusic');
  let installationDirectory = installed;
  let passed = false;
  try {
    const baseline = await build('1.6.1', false);
    const fixed = await build('1.6.2', true);
    await install(baseline.installer, installed);
    assert.equal(installedVersion(installed), '1.6.1');
    fs.cpSync(baseline.unpacked, portable, {recursive:true});
    let older = await launch(portable);
    await older.page.evaluate(() => localStorage.setItem('medo.upgradeFixture', 'preserved'));
    await older.application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().forEach(window => window.hide()));
    await rewriteLinks(path.join(portable, `${testName}.exe`));
    await install(baseline.installer, installed, true);
    assert.ok((await links()).every(link => link.target === path.join(portable, `${testName}.exe`)));
    cases.push('Original installer reproduces stale shortcuts pointing outside the updated installation');
    console.log('1/5: original installer stale-shortcut failure reproduced');

    // PowerShell availability determines whether the original installer closes
    // the outside-directory process. Always start the next case with it running.
    if (older.process.exitCode !== null) {
      older = await launch(portable);
      await older.application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().forEach(window => window.hide()));
    }
    assert.equal(await older.application.evaluate(({app}) => app.getVersion()), '1.6.1');

    await install(fixed.installer, installed, true);
    assert.ok(older.process.exitCode !== null, 'Upgrade must close the old outside-directory instance');
    const current = await checkUpdated(installed, fixed);
    cases.push('1.6.1 to 1.6.2 closes the old instance, repairs both shortcuts and preserves settings');
    console.log('2/5: cross-directory old instance closed; new executable and both shortcuts verified');

    fs.writeFileSync(path.join(installed, 'obsolete-file.txt'), 'old installation residue');
    await install(fixed.installer, installed, true);
    assert.ok(current.process.exitCode !== null, 'Same-version replacement closes the prior process');
    assert.equal(fs.existsSync(path.join(installed, 'obsolete-file.txt')), false);
    const replaced = await checkUpdated(installed, fixed);
    cases.push('Same-version 1.6.2 replacement refreshes the application and removes obsolete program files');
    console.log('3/5: same-version replacement verified');

    await install(fixed.installer, relocated, true);
    installationDirectory = relocated;
    assert.ok(replaced.process.exitCode !== null);
    assert.equal(fs.existsSync(path.join(installed, `${testName}.exe`)), false);
    const moved = await checkUpdated(relocated, fixed);
    cases.push('Changing the installation directory updates registered location, executable and shortcuts');
    console.log('4/5: changed installation directory verified');

    for (const link of await links()) {
      assert.equal(path.basename(link.path), `${testName}.lnk`);
      fs.unlinkSync(link.path);
    }
    await install(fixed.installer, relocated, true);
    assert.ok(moved.process.exitCode !== null);
    assert.equal(installedVersion(relocated), '1.6.2');
    assert.deepEqual(await links(), [], 'User-deleted shortcuts remain deleted during an update');
    assert.deepEqual(await links('MedoMusic'), realLinksBefore, 'Production shortcuts remain untouched');
    cases.push('User-deleted links stay deleted and production shortcuts are unchanged');
    console.log('5/5: shortcut preferences and production isolation verified');
    assert.equal(cases.length, 5);
    passed = true;
  } finally {
    for (const {application,process:launchedProcess} of applications) {
      if (launchedProcess.exitCode === null) await application.close().catch(() => {});
    }
    // Only the isolated GUID and explicitly bounded fixture installation are removed.
    const currentRegistration = await registration();
    if (currentRegistration) {
      assert.ok(path.resolve(installationDirectory).startsWith(base + path.sep));
      const uninstall = path.join(installationDirectory, `Uninstall ${testName}.exe`);
      await execute(uninstall, ['/S', '/currentuser'], {cwd:base, env, windowsHide:true, timeout:90000});
    }
    const cleanupDeadline = Date.now() + 15000;
    while (await registration() && Date.now() < cleanupDeadline) await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await registration(), null);
    assert.deepEqual(await links('MedoMusic'), realLinksBefore);
    fs.writeFileSync(path.join(base, 'results.json'), JSON.stringify({passed,cases,profile,productionShortcuts:realLinksBefore}, null, 2));
    fs.writeFileSync(path.join(root, 'tests', 'artifacts', 'installer-upgrade', 'latest.json'), JSON.stringify({passed,cases,report:path.join(base, 'results.json')}, null, 2));
  }
  console.log('Real installer upgrade passed: 5/5 scenarios');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
