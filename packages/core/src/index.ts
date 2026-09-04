export { loadConfig, resetConfigForTests, type AppConfig } from "./config.ts";
export { logger, requestLogger, workerLogger } from "./logger.ts";
export { ok, err, unwrap, type Result } from "./result.ts";
export {
  QUEUES,
  type Queue,
  type QueueName,
  type EnqueueOptions,
  type JobHandler,
} from "./queue/queue.ts";
export { PgBossQueue } from "./queue/pgboss.ts";
export { registerHandlers, recoverMissedRun, type HandlerMode } from "./handlers.ts";
export {
  SafeFetcher,
  isPrivateAddress,
  type FetchError,
  type FetchOk,
} from "./fetch/safe-fetcher.ts";
export { refreshCompany, type RefreshOutcome, type IngestDeps } from "./ingestion/ingest.ts";
export {
  orchestrateRefresh,
  completeFinishedRuns,
  findMissedSlot,
} from "./ingestion/orchestrator.ts";
export { classifyMarket, type MarketEligibility } from "./market/market-filter.ts";
export { detectProvider, getProvider, allProviders } from "./providers/registry.ts";
export type { JobProvider, ProviderId, Detection, NormalizedJob } from "./providers/types.ts";
export {
  normalizeTitle,
  normalizeLocation,
  normalizeSkill,
  seniorityOf,
  titleSimilarity,
} from "./taxonomy/taxonomy.ts";
export {
  inferEmails,
  learnPattern,
  applyPattern,
  parseName,
  PATTERNS,
} from "./contacts/pattern-engine.ts";
export { EmailValidator, type EmailStatus } from "./contacts/email-validator.ts";
export {
  renderTemplate,
  resolveRelevantSkill,
  BUILTIN_TEMPLATES,
} from "./outreach/template-renderer.ts";
export { encryptToken, decryptToken } from "./outreach/token-crypto.ts";
export {
  RealGmailClient,
  FakeGmailClient,
  type GmailClient,
  type TokenBundle,
} from "./outreach/gmail.ts";
export {
  prepareOutreach,
  approveOutreach,
  emailHash,
  type Preview,
  type PrepareInput,
  type ApproveInput,
} from "./outreach/outreach.ts";
export { discoverContacts, contactRelevance, type DiscoveredPerson } from "./contacts/discovery.ts";
export { HunterClient, type HunterOutcome } from "./contacts/hunter.ts";
export {
  scoreJob,
  bandOf,
  candidateSeniority,
  type MatchBand,
  type MatchJob,
  type MatchProfile,
  type MatchResult,
} from "./matching/matching-engine.ts";
export { extractSkills } from "./matching/skills-in-text.ts";
export { recomputeForCompany, recomputeForUser, toMatchProfile } from "./matching/recompute.ts";
export { tickRefresh } from "./ingestion/orchestrator.ts";
export {
  LogNotifier,
  RoutingNotifier,
  SmtpNotifier,
  TelegramNotifier,
  type Notifier,
  type NotifyMessage,
  type NotifyTarget,
} from "./notify/notifier.ts";
export { buildNotifier } from "./notify/build.ts";
export { dispatchDigest, dispatchInstant, localParts } from "./notify/alerts.ts";
export {
  createCampaign,
  setCampaignStatus,
  drainCampaigns,
  syncReplies,
  UNSUBSCRIBE_LINE,
  type CampaignDeps,
  type CreateCampaignInput,
} from "./outreach/campaigns.ts";
export {
  gmailAccountForUser,
  gmailClientForUser,
  gmailScopesFor,
  hasScope,
  GMAIL_SCOPE,
} from "./outreach/gmail-accounts.ts";
export { newRfcMessageId } from "./outreach/outreach.ts";
export {
  AnthropicPersonalizer,
  NullPersonalizer,
  buildPersonalizer,
  type Personalizer,
  type PersonalizeInput,
} from "./outreach/personalize.ts";
