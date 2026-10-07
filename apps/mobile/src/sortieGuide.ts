import type { DrivingRoute, Sortie, SortieStop, Tariff } from "@groundops/contracts";

export type SortieGuideCommand = {
  sortieId: string;
  stops: SortieStop[];
  firstStopPosition: number;
  route: DrivingRoute;
  tariff: Tariff | null;
  sortie: Sortie;
};
