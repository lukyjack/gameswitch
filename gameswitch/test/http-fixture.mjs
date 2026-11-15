import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';

// Windows may allocate an ephemeral port forbidden by Fetch's bad-port list.
// Bind from an unprivileged high range instead, retrying only real collisions.
export async function listenFixture(app) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const server = createServer(app);
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        server.listen(randomInt(20000, 60000), '127.0.0.1');
      });
      return server;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && !(process.platform === 'win32' && error.code === 'EACCES')) throw error;
    }
  }
  throw new Error('No test HTTP port available');
}
