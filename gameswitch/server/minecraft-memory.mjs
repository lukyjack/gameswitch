export const FTB_NATIVE_RESERVE_MB = 2048;

export function minecraftMemory(profile) {
  const ftb = profile.loader === 'ftb';
  const available = Math.max(512, profile.memoryMb - (ftb ? FTB_NATIVE_RESERVE_MB : 768));
  const recommended = ftb && Number.isFinite(profile.recommendedMemoryMb) && profile.recommendedMemoryMb > 0 ? profile.recommendedMemoryMb : available;
  const maximumMb = Math.min(available, recommended);
  return { maximumMb, initialMb: Math.min(2048, maximumMb) };
}

export function ftbEnvironment(profile, previous = {}) {
  const { maximumMb, initialMb } = minecraftMemory(profile);
  if (Number.isFinite(profile.minimumMemoryMb) && maximumMb < profile.minimumMemoryMb) {
    throw Object.assign(new Error(`Das FTB-Profil benötigt mindestens ${profile.minimumMemoryMb + FTB_NATIVE_RESERVE_MB} MB Profil-RAM einschließlich Java-Reserve. Bitte das RAM-Budget erhöhen.`), { status: 400 });
  }
  const result = { ...previous, MEMORY: `${maximumMb}M`, MAX_MEMORY: `${maximumMb}M`, INIT_MEMORY: `${initialMb}M` };
  if (!(result.JVM_OPTS || '').includes('-Dio.netty.native.workdir=')) result.JVM_OPTS = `${result.JVM_OPTS || ''} -Dio.netty.native.workdir=/data/.cache/netty`.trim();
  return result;
}
