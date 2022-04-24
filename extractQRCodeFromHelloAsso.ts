import { existsSync, writeFileSync } from 'fs';
import { URL } from 'url';
import {
  downloadTicket,
  extractParticipantsFromCsv,
  extractQRCode,
  Participant,
  ticketFilePathFromTicketUrl,
} from './src/utils';

(async () => {
  const participants = await extractParticipantsFromCsv(process.argv[2]);
  const participantsWithQRCode: Record<string, Participant> = {};

  for (const participant of participants.filter(
    (p: string[]) => p[4] === 'Validé' && p[5] === 'Billet Conférences'
  )) {
    const ticketUrl: URL = new URL(participant[8]);
    const email: string = participant[1];
    const lastname: string = participant[2];
    const firstname: string = participant[3];
    const ticketFilePath = ticketFilePathFromTicketUrl(ticketUrl);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!existsSync(ticketFilePath)) {
      await downloadTicket(ticketUrl, process.argv[3]);
    }
    const qrCode = await extractQRCode(ticketFilePath);
    console.log(email, qrCode);
    participantsWithQRCode[qrCode] = {
      email,
      displayName: `${firstname} ${lastname}`,
      qrCode,
    };
  }
  writeFileSync(
    'participants.json',
    JSON.stringify(participantsWithQRCode, null, 2)
  );
})();
