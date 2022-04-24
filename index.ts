import express, { NextFunction, Request, Response } from 'express';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { Participant, Rump, assertIsString } from './src/utils';
import { json } from 'body-parser';
// eslint-disable-next-line node/no-unpublished-import
const participants = JSON.parse(readFileSync('./participants.json', 'utf-8'));
const app = express();

const AUTH_HEADER = 'rump-sthack-auth';

function authenticationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const rumpSthackAuthHeader = req.header(AUTH_HEADER);
  if (rumpSthackAuthHeader) {
    console.log(rumpSthackAuthHeader);
    const participant: Participant | undefined =
      participants[rumpSthackAuthHeader];
    if (participant) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      req.participant = participant;
      return next();
    }
  }
  res.status(401);
  throw Error('Invalid authentication');
}

function initConfig() {
  return {
    port: process.env.STHACK_RUMP_PORT
      ? parseInt(process.env.STHACK_RUMP_PORT, 10)
      : 3000,
    hostname: process.env.STHACK_RUMP_HOSTNAME ?? 'localhost',
  };
}
const config = initConfig();

app.use(express.static('app'));

app.use(authenticationMiddleware);
app.use(json());

app.get('/rump', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const participant = req.participant;
  const rumpFile = `rumps/${participant.qrCode}.json`;
  let rump: Rump = {
    title: '',
    description: '',
    speaker: '',
  };
  if (existsSync(rumpFile)) {
    rump = JSON.parse(readFileSync(rumpFile, 'utf-8'));
  }

  assertIsString(rump.description);
  assertIsString(rump.speaker);
  assertIsString(rump.title);
  res.send(rump);
});

app.put('/rump', (req, res) => {
  console.log(req.body);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const participant = req.participant;
  const rumpFile = `rumps/${participant.qrCode}.json`;
  const rump: Rump = {
    title: req.body.title ?? '',
    description: req.body.description ?? '',
    speaker: req.body.speaker ?? '',
  };

  writeFileSync(rumpFile, JSON.stringify(rump), 'utf-8');
  res.send(rump);
});

app.listen(config.port, config.hostname, () => {
  console.log(`Server listening on ${config.hostname}:${config.port}`);
});
