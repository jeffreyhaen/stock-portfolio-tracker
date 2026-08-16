import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function start(script) {
    if (process.platform === 'win32') {
        return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${npm} run ${script}`], { stdio: 'inherit' });
    }
    return spawn(npm, ['run', script], { stdio: 'inherit' });
}

const children = [start('app'), start('market-data-proxy')];
let shuttingDown = false;

function shutdown(code) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    for (const child of children) {
        if (!child.killed) {
            child.kill('SIGTERM');
        }
    }
    setTimeout(() => process.exit(code), 1000).unref();
}

for (const child of children) {
    child.on('error', (error) => {
        console.error(error);
        shutdown(1);
    });
    child.on('exit', (code) => {
        if (!shuttingDown) {
            shutdown(code ?? 1);
        }
    });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
