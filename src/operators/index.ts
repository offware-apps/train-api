import type { GtfsOperator } from "../gtfs";
import { NL, NL_GTFS_URL } from "./nl";
import { RENFE, RENFE_GTFS_URL } from "./renfe";

/** Operators read from a GTFS feed: where to download it, and how to read it. */
export const GTFS_OPERATORS: { op: GtfsOperator; url: string }[] = [
  { op: RENFE, url: RENFE_GTFS_URL },
  { op: NL, url: NL_GTFS_URL },
];
