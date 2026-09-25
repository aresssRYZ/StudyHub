export function isCloseIntent(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[,.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:makasih|terima kasih|thanks) )?(?:(?:sudah|udah) )?(?:selesai|cukup|udahan|berhenti|stop|sampai sini)(?: (?:dulu|ya|aja|deh|makasih|terima kasih))*$/.test(normalized);
}
