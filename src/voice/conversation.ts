import type { AiMessage } from '../ai/types.js';
import { AiService } from '../ai/ai-service.js';

export type VoiceMode = 'assistant' | 'casual' | 'curhat';

const common = 'Kamu StudyHub AI. Bicara bahasa Indonesia dengan sapaan aku dan kamu, natural dan santai. Jawab umumnya 1 sampai 4 kalimat; jika diminta rinci, boleh lebih panjang. Jangan gunakan emoji atau format markdown. Jangan mengarang fakta.';
export const voicePrompts: Record<VoiceMode, string> = {
  assistant: `${common} Bantu belajar, jelaskan konsep dan tugas dengan jelas, serta beri contoh bila membantu.`,
  casual: `${common} Ngobrol seperti teman. Boleh bercanda ringan dan bertanya balik sewajarnya. Tidak semua topik perlu dijadikan pelajaran atau solusi.`,
  curhat: `${common} Dengarkan dengan hangat dan tanpa menghakimi. Jangan buru-buru memberi solusi kecuali diminta. Jangan mendiagnosis atau mengaku sebagai tenaga profesional. Bila ada risiko keselamatan, dorong mencari bantuan nyata segera.`
};

export class VoiceConversationService {
  private readonly history: AiMessage[] = [];
  constructor(private readonly ai: AiService, private readonly maxMessages: number) {}
  async respond(text: string, mode: VoiceMode, signal?: AbortSignal): Promise<string> {
    const answer = await this.ai.generate({ systemPrompt: voicePrompts[mode], history: [...this.history], userMessage: text }, 0);
    if (signal?.aborted) throw signal.reason;
    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
    if (this.history.length > this.maxMessages) this.history.splice(0, this.history.length - this.maxMessages);
    return answer;
  }
  clear(): void { this.history.length = 0; }
}
