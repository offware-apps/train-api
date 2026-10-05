import type { GtfsOperator } from "../gtfs";
import { CH, CH_GTFS_URL } from "./ch";
import { DE, DE_GTFS_URL } from "./de";
import { FI, FI_GTFS_URL, FI_HEADERS } from "./fi";
import { IE, IE_GTFS_URL } from "./ie";
import { IT, IT_GTFS_URL } from "./it";
import { NL, NL_GTFS_URL } from "./nl";
import { NO, NO_GTFS_URL } from "./no";
import { RENFE, RENFE_GTFS_URL } from "./renfe";

/** Operators read from a GTFS feed: where to download it, and how to read it. */
export const GTFS_OPERATORS: { op: GtfsOperator; url: string; headers?: Record<string, string> }[] = [
  { op: RENFE, url: RENFE_GTFS_URL },
  { op: NL, url: NL_GTFS_URL },
  { op: DE, url: DE_GTFS_URL },
  { op: IT, url: IT_GTFS_URL },
  { op: CH, url: CH_GTFS_URL },
  { op: NO, url: NO_GTFS_URL },
  { op: FI, url: FI_GTFS_URL, headers: FI_HEADERS },
  { op: IE, url: IE_GTFS_URL },
];
