/**
 * Starts the Firebase Emulator Suite.
 *
 * The Firestore emulator needs a JDK. Plenty of machines have one installed but
 * not on PATH (bundled with Android Studio, JetBrains IDEs, or Microsoft's
 * OpenJDK), so look around before giving up and telling the user to install it.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const javaBin = isWindows ? 'java.exe' : 'java';

/** Directories that commonly hold one or more JDKs, as `parent/<version>/`. */
const JDK_PARENTS = isWindows
  ? [
      'C:/Program Files/Microsoft',
      'C:/Program Files/Java',
      'C:/Program Files/Eclipse Adoptium',
      'C:/Program Files/Amazon Corretto',
      'C:/Program Files/Zulu',
      'C:/Program Files/JetBrains',
      'C:/Program Files/Android/Android Studio',
    ]
  : [
      '/usr/lib/jvm',
      '/Library/Java/JavaVirtualMachines',
      '/opt/homebrew/opt/openjdk',
      '/usr/local/opt/openjdk',
    ];

function javaHomeCandidates() {
  const found = [];
  if (process.env.JAVA_HOME) found.push(process.env.JAVA_HOME);

  for (const parent of JDK_PARENTS) {
    if (!existsSync(parent)) continue;
    // The parent itself may be a JDK (e.g. /opt/homebrew/opt/openjdk).
    found.push(parent);
    let entries = [];
    try {
      entries = readdirSync(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(parent, entry.name);
      found.push(dir);
      // JetBrains IDEs and Android Studio nest theirs under `jbr/`.
      found.push(path.join(dir, 'jbr'));
      found.push(path.join(dir, 'Contents', 'Home'));
    }
  }
  return found;
}

function resolveJavaHome() {
  if (hasJavaOnPath()) return null; // nothing to do
  for (const candidate of javaHomeCandidates()) {
    if (existsSync(path.join(candidate, 'bin', javaBin))) return candidate;
  }
  return undefined; // searched, found nothing
}

function hasJavaOnPath() {
  const dirs = (process.env.PATH ?? '').split(isWindows ? ';' : ':');
  return dirs.some((dir) => dir && existsSync(path.join(dir, javaBin)));
}

const javaHome = resolveJavaHome();
const env = { ...process.env };

if (javaHome === undefined) {
  console.error(
    [
      '',
      '  The Firestore emulator needs Java, and none was found.',
      '',
      '  Install a JDK (17 or newer), then re-run `npm run demo`:',
      '',
      isWindows
        ? '    winget install Microsoft.OpenJDK.21'
        : process.platform === 'darwin'
          ? '    brew install openjdk@21'
          : '    sudo apt install openjdk-21-jdk',
      '',
      '  Already have one? Point JAVA_HOME at it and try again.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${path.join(javaHome, 'bin')}${isWindows ? ';' : ':'}${env.PATH}`;
  console.log(`Using JDK at ${javaHome}`);
}

/*
 * Run the CLI's entry point under this Node process rather than shelling out to
 * npx. On Windows `npx.cmd` needs `shell: true`, which puts a cmd.exe between us
 * and the emulators - killing it leaves the emulator processes orphaned and the
 * ports held. Spawning the JS entry point directly gives us a PID we can
 * actually signal.
 */
const firebaseBin = fileURLToPath(
  import.meta.resolve('firebase-tools/lib/bin/firebase.js'),
);

/*
 * Persist emulator state between runs. Without this the Auth emulator forgets
 * its users on every restart, which silently breaks a seeded demo: the new
 * sign-in gets a fresh uid, stops matching `ownerId` on the seeded documents,
 * and the ownership rule denies every query.
 */
const dataDir = path.resolve('.emulator-data');
mkdirSync(dataDir, { recursive: true });

const args = [
  firebaseBin,
  'emulators:start',
  '--only',
  'auth,firestore',
  '--import',
  dataDir,
  '--export-on-exit',
  dataDir,
  ...process.argv.slice(2),
];
const child = spawn(process.execPath, args, { env, stdio: 'inherit' });

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (isWindows) {
    // Windows has no process groups; take the whole tree down explicitly so the
    // Java-based Firestore emulator does not survive and hold port 8080.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill(signal);
  }
}

child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(signal));
}
process.on('exit', () => shutdown('SIGTERM'));
