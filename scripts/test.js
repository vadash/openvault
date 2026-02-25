import { exec } from 'child_process';

const commands = ['npm run sync-version', 'vitest run --reporter=dot'];

for (const cmd of commands) {
    await new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                // On last command failure, show the full output
                if (cmd.includes('vitest')) {
                    console.log(stdout);
                    console.error(stderr);
                }
                reject(error);
            } else {
                resolve();
            }
        });
    }).catch(() => {
        // If vitest fails, exit with error
        if (cmd.includes('vitest')) process.exit(1);
    });
}

console.log('OK');
