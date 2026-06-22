import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { stdin, stdout, exit } from 'node:process';

function base64Url(buffer) {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!stdin.isTTY) {
    let value = '';
    for await (const chunk of stdin) value += chunk;
    return value.trimEnd();
  }

  return new Promise((resolve) => {
    let value = '';
    stdout.write('Password: ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      resolve(value);
    };

    stdin.on('data', (char) => {
      if (char === '\u0003') {
        stdout.write('\n');
        exit(130);
      }
      if (char === '\r' || char === '\n') {
        done();
        return;
      }
      if (char === '\u007f') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    });
  });
}

const password = await readPassword();
if (!password) {
  console.error('Password is required');
  exit(1);
}

const iterations = 120000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
console.log(`pbkdf2_sha256$${iterations}$${base64Url(salt)}$${base64Url(hash)}`);
