export type ReportInsightKind = "bottleneck" | "supporting" | "opportunity" | "superpower";

export type ReportAnalysisCategory =
  | "Outreach Performance"
  | "Creator Acquisition"
  | "Creator Portfolio Quality"
  | "Creator Monetisation"
  | "Deals"
  | "Revenue"
  | "Goals"
  | "Team Benchmarks";

export type ReportInsight = {
  id: string;
  kind: ReportInsightKind;
  category: ReportAnalysisCategory;
  title: string;
  observation: string;
  diagnosis?: string;
  recommendation?: string;
  evidence: string[];
  actions: [string, string, string];
  priority: number;
};

type ReportTemplate = Omit<ReportInsight, "evidence" | "priority">;

export const REPORT_TEMPLATES = {
  activityBaseline: {
    id: "activity-baseline",
    kind: "bottleneck",
    category: "Team Benchmarks",
    title: "Consistency / activity",
    observation:
      "There is not enough clean activity data yet, so the most useful focus is building a steadier operating rhythm.",
    recommendation: "Build a cleaner activity base before judging deeper funnel issues.",
    actions: [
      "Set a clear weekly activity baseline.",
      "Track the first funnel step that breaks.",
      "Record why creator or brand conversations stall.",
    ],
  },
  supportingBaseline: {
    id: "supporting-baseline",
    kind: "supporting",
    category: "Team Benchmarks",
    title: "Team benchmark context",
    observation:
      "The current snapshot does not show a stronger secondary issue than the primary bottleneck.",
    recommendation: "Use the main bottleneck as the operating focus.",
    actions: [
      "Focus on the selected bottleneck.",
      "Keep the dashboard data clean.",
      "Review the secondary signal after the next data update.",
    ],
  },
  opportunityBaseline: {
    id: "opportunity-baseline",
    kind: "opportunity",
    category: "Team Benchmarks",
    title: "Focused improvement",
    observation:
      "The clearest opportunity is to improve the first weak funnel step before adding complexity.",
    recommendation: "Improve the next conversion step in the funnel.",
    actions: [
      "Identify the weakest funnel step.",
      "Make one targeted improvement.",
      "Check whether the next metric moves.",
    ],
  },
  sourcingProblem: {
    id: "sourcing-problem",
    kind: "bottleneck",
    category: "Outreach Performance",
    title: "Sourcing volume",
    observation: "You are generating fewer sourcing opportunities than the rest of the team.",
    recommendation: "Increase the number of suitable creators entering the funnel.",
    actions: [
      "Increase sourcing activity.",
      "Expand creator search criteria.",
      "Build a larger weekly pipeline.",
    ],
  },
  outreachQualityProblem: {
    id: "outreach-quality-problem",
    kind: "bottleneck",
    category: "Outreach Performance",
    title: "Outreach quality",
    observation: "You are generating activity but outreach quality may be limiting results.",
    diagnosis: "Possible causes: targeting quality, outreach messaging, or creator fit.",
    recommendation: "Review targeting, messaging, and creator fit.",
    actions: ["Review targeting.", "Review outreach messaging.", "Review creator fit."],
  },
  followUpBottleneck: {
    id: "follow-up-bottleneck",
    kind: "bottleneck",
    category: "Outreach Performance",
    title: "Follow-up conversion",
    observation: "Creators are responding, but fewer conversations are progressing into calls.",
    recommendation: "Reduce friction between reply and booked call.",
    actions: [
      "Improve follow-up speed.",
      "Improve booking process.",
      "Reduce scheduling friction.",
    ],
  },
  callConversionBottleneck: {
    id: "call-conversion-bottleneck",
    kind: "bottleneck",
    category: "Outreach Performance",
    title: "Call conversion",
    observation: "You are successfully creating meetings but too few become signed creators.",
    diagnosis:
      "Possible causes: creator objections, offer positioning, qualification issues, meeting quality, or creator no-shows.",
    recommendation: "Review qualification, offer positioning, and meeting follow-up.",
    actions: [
      "Review creator objections from recent calls.",
      "Tighten offer positioning.",
      "Improve meeting qualification and follow-up.",
    ],
  },
  pipelineHealth: {
    id: "pipeline-health",
    kind: "opportunity",
    category: "Outreach Performance",
    title: "Pipeline health",
    observation: "Current revenue is below target, but your pipeline remains healthy.",
    recommendation: "Protect the pipeline while improving downstream conversion.",
    actions: [
      "Keep sourcing and replies consistent.",
      "Focus on the next weak conversion step.",
      "Move the healthiest pipeline into revenue activity.",
    ],
  },
  hiddenPipeline: {
    id: "hidden-pipeline",
    kind: "opportunity",
    category: "Outreach Performance",
    title: "Hidden pipeline",
    observation: "You already have meaningful activity in the pipeline.",
    recommendation: "Small improvements in conversion could unlock significant growth.",
    actions: [
      "Review why calls are not converting.",
      "Tighten call follow-up.",
      "Improve the handoff from signed creator to deal activity.",
    ],
  },
  creatorQuantityProblem: {
    id: "creator-quantity-problem",
    kind: "bottleneck",
    category: "Creator Acquisition",
    title: "Creator quantity",
    observation: "You currently do not have enough creators to consistently generate revenue.",
    recommendation: "Sign more suitable exclusive creators.",
    actions: [
      "Prioritise creator acquisition.",
      "Focus on creators with clear brand fit.",
      "Build a larger roster before chasing small optimisations.",
    ],
  },
  creatorQualityProblem: {
    id: "creator-quality-problem",
    kind: "bottleneck",
    category: "Creator Portfolio Quality",
    title: "Creator quality / monetisation",
    observation:
      "You already have enough creators. The challenge appears to be creator quality or monetisation.",
    recommendation: "Review whether the current roster is commercially strong enough.",
    actions: [
      "Audit the signed roster.",
      "Prioritise creators with stronger brand fit.",
      "Tighten future signing criteria.",
    ],
  },
  creatorActivationProblem: {
    id: "creator-activation-problem",
    kind: "bottleneck",
    category: "Creator Monetisation",
    title: "Creator activation",
    observation:
      "You have successfully signed creators, but too few are generating active opportunities.",
    recommendation: "Turn the current roster into live deal activity.",
    actions: [
      "Pick inactive creators and build brand angles.",
      "Push signed creators into live opportunities.",
      "Review which creators need repositioning.",
    ],
  },
  underutilisedCreators: {
    id: "underutilised-creators",
    kind: "supporting",
    category: "Creator Monetisation",
    title: "Underutilised creators",
    observation: "Several creators in your roster are not contributing meaningful deal activity.",
    recommendation: "Find more opportunities, improve positioning, or review fit.",
    actions: [
      "Find more opportunities.",
      "Improve positioning.",
      "Review creator fit.",
    ],
  },
  revenueConcentrationRisk: {
    id: "revenue-concentration-risk",
    kind: "supporting",
    category: "Revenue",
    title: "Revenue concentration",
    observation: "A large percentage of your revenue currently depends on a single creator.",
    recommendation: "Build revenue from the second and third strongest creators.",
    actions: [
      "Develop the next strongest creators.",
      "Avoid over-relying on one creator.",
      "Create brand angles for the wider roster.",
    ],
  },
  portfolioConcentration: {
    id: "portfolio-concentration",
    kind: "supporting",
    category: "Creator Portfolio Quality",
    title: "Portfolio concentration",
    observation: "Revenue generation is concentrated among a small number of creators.",
    recommendation: "Spread commercial value across more of the roster.",
    actions: [
      "Identify the next creator tier.",
      "Build offers for underused creators.",
      "Reduce dependence on the top roster slice.",
    ],
  },
  highRevenueEfficiency: {
    id: "high-revenue-efficiency",
    kind: "opportunity",
    category: "Revenue",
    title: "Revenue efficiency",
    observation: "Your creators generate more revenue per creator than the team average.",
    recommendation: "Scale what is already working without lowering creator quality.",
    actions: [
      "Document which creator traits are working.",
      "Use those traits in new signings.",
      "Protect quality as the roster grows.",
    ],
  },
  lowRevenueEfficiency: {
    id: "low-revenue-efficiency",
    kind: "supporting",
    category: "Revenue",
    title: "Revenue efficiency",
    observation:
      "Your roster size is healthy, but revenue generated per creator is below the team average.",
    recommendation: "Improve monetisation per creator before expanding too far.",
    actions: [
      "Review low-revenue creators.",
      "Prioritise higher-value opportunities.",
      "Improve creator positioning.",
    ],
  },
  opportunityDensity: {
    id: "opportunity-density",
    kind: "supporting",
    category: "Deals",
    title: "Opportunity density",
    observation: "Deal activity per creator suggests there is room to improve creator monetisation.",
    recommendation: "Increase the number of deal opportunities per exclusive creator.",
    actions: [
      "Map creators to stronger brand categories.",
      "Increase brand pitching for the current roster.",
      "Track creators with no deal activity.",
    ],
  },
  dealValueProblem: {
    id: "deal-value-problem",
    kind: "bottleneck",
    category: "Deals",
    title: "Deal value",
    observation:
      "Deal activity exists, but the value per deal is below the team benchmark.",
    recommendation: "Pursue higher-value brand partnerships.",
    actions: [
      "Prioritise brands with stronger budgets.",
      "Use strong past deals as pricing proof.",
      "Avoid filling the pipeline with low-value work.",
    ],
  },
  brandConversionProblem: {
    id: "brand-conversion-problem",
    kind: "bottleneck",
    category: "Deals",
    title: "Brand conversion / pitching",
    observation:
      "Creator supply exists, but the deal count is not keeping pace with the roster.",
    recommendation: "Improve pitching, follow-up, and offer negotiation.",
    actions: [
      "Turn creators into specific brand pitches.",
      "Follow up with creator-specific angles.",
      "Review pricing and objection patterns.",
    ],
  },
  strongOutreachPerformer: {
    id: "strong-outreach-performer",
    kind: "opportunity",
    category: "Outreach Performance",
    title: "Strong outreach performer",
    observation: "Your outreach generates stronger engagement than the team average.",
    recommendation: "Your targeting or messaging approach may be worth sharing with the team.",
    actions: [
      "Save your strongest outreach examples.",
      "Share what is working with the team.",
      "Keep using the targeting pattern that is generating replies.",
    ],
  },
  bestBooker: {
    id: "best-booker",
    kind: "opportunity",
    category: "Outreach Performance",
    title: "Best Booker",
    observation: "You convert replies into meetings more effectively than most team members.",
    recommendation: "Keep the booking process simple and repeatable.",
    actions: [
      "Keep the booking process simple.",
      "Document what makes creators agree to calls.",
      "Use the same flow on more qualified creators.",
    ],
  },
  bestCloser: {
    id: "best-closer",
    kind: "opportunity",
    category: "Outreach Performance",
    title: "Best Closer",
    observation: "You convert meetings into signed creators more effectively than most team members.",
    recommendation: "Your qualification or meeting process may be particularly effective.",
    actions: [
      "Write down the call flow that is working.",
      "Use the same qualification questions consistently.",
      "Share the strongest call learnings with the team.",
    ],
  },
  creatorAcquisitionSuperpower: {
    id: "creator-acquisition-superpower",
    kind: "superpower",
    category: "Creator Acquisition",
    title: "Creator Acquisition",
    observation:
      "Your creator count is ahead of the team benchmark, which suggests strong sourcing and acquisition discipline.",
    recommendation: "Keep acquisition quality high as the roster grows.",
    actions: [
      "Protect creator quality.",
      "Share your sourcing habits.",
      "Keep tracking which creators become commercial.",
    ],
  },
  outreachQualitySuperpower: {
    id: "outreach-quality-superpower",
    kind: "superpower",
    category: "Outreach Performance",
    title: "Outreach Quality",
    observation:
      "Your reply rate significantly exceeds the team average, suggesting strong creator targeting and messaging.",
    recommendation: "Keep using the outreach patterns that create replies.",
    actions: [
      "Save winning outreach examples.",
      "Share the pattern with the team.",
      "Use it on more qualified creators.",
    ],
  },
  meetingBookingSuperpower: {
    id: "meeting-booking-superpower",
    kind: "superpower",
    category: "Outreach Performance",
    title: "Meeting Booking",
    observation:
      "Your booking rate is ahead of the team benchmark, which suggests a strong reply-to-call process.",
    recommendation: "Keep the booking flow simple and repeatable.",
    actions: [
      "Document your booking flow.",
      "Reduce scheduling friction.",
      "Apply the same process to more replies.",
    ],
  },
  closingConversationsSuperpower: {
    id: "closing-conversations-superpower",
    kind: "superpower",
    category: "Outreach Performance",
    title: "Closing Conversations",
    observation:
      "Your call closing rate is above the team benchmark, which suggests strong qualification and meeting handling.",
    recommendation: "Turn the closing process into a repeatable team play.",
    actions: [
      "Document your strongest call questions.",
      "Keep improving objection handling.",
      "Share the call flow with the team.",
    ],
  },
  creatorMonetisationSuperpower: {
    id: "creator-monetisation-superpower",
    kind: "superpower",
    category: "Creator Monetisation",
    title: "Creator Monetisation",
    observation:
      "Your deal value is ahead of the team benchmark, which suggests strong creator monetisation.",
    recommendation: "Keep pushing high-fit creators into stronger commercial opportunities.",
    actions: [
      "Repeat the creator-brand patterns that convert.",
      "Use strong deals as proof.",
      "Prioritise creators with clear commercial pull.",
    ],
  },
  revenueEfficiencySuperpower: {
    id: "revenue-efficiency-superpower",
    kind: "superpower",
    category: "Revenue",
    title: "Revenue Efficiency",
    observation:
      "Your revenue per exclusive creator is above the team benchmark, which suggests efficient monetisation.",
    recommendation: "Scale carefully without lowering creator quality.",
    actions: [
      "Identify why top creators perform.",
      "Use that pattern in new signings.",
      "Avoid adding creators without commercial fit.",
    ],
  },
  relationshipBuildingSuperpower: {
    id: "relationship-building-superpower",
    kind: "superpower",
    category: "Outreach Performance",
    title: "Relationship Building",
    observation:
      "Your pipeline activity shows relationship-building potential that can be converted into stronger outcomes.",
    recommendation: "Keep moving conversations through the funnel with consistent follow-up.",
    actions: [
      "Keep conversations warm.",
      "Follow up with clear next steps.",
      "Turn replies into booked conversations.",
    ],
  },
} satisfies Record<string, ReportTemplate>;

export type ReportTemplateId = keyof typeof REPORT_TEMPLATES;

export function buildTemplateInsight(
  templateId: ReportTemplateId,
  priority: number,
  evidence: string[],
  overrides?: Partial<Pick<ReportInsight, "diagnosis" | "recommendation" | "actions">>,
): ReportInsight {
  const template = REPORT_TEMPLATES[templateId];

  return {
    ...template,
    ...overrides,
    evidence,
    priority,
  };
}
