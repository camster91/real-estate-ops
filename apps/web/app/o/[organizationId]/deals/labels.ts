import {
	DEAL_SIDE_LABELS,
	DEAL_STAGE_LABELS,
	type DealSide,
	type DealStage,
} from "@reo/domain";

export const sideLabel = (side: string) =>
	DEAL_SIDE_LABELS[side as DealSide] ?? side;
export const stageLabel = (stage: string) =>
	DEAL_STAGE_LABELS[stage as DealStage] ?? stage;
