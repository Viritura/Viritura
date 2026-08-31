export interface SplitPolicy {
  readonly id: string;
  readonly acceptedNames: readonly string[];
  readonly players: readonly { readonly name: string; readonly shortName: string }[];
  readonly sourceTargets: ReadonlyMap<number, readonly number[]>;
}

export const SPLIT_POLICIES: readonly SplitPolicy[] = [
  {
    id: "P2",
    acceptedNames: ["Oboi"],
    players: [
      { name: "Oboe 1", shortName: "Ob. 1" },
      { name: "Oboe 2", shortName: "Ob. 2" },
    ],
    sourceTargets: new Map([[1, [1, 2]]]),
  },
  {
    id: "P3",
    acceptedNames: ["Clarinetti in Bb", "Clarinets in B♭"],
    players: [
      { name: "Clarinet in B♭ 1", shortName: "Cl. 1" },
      { name: "Clarinet in B♭ 2", shortName: "Cl. 2" },
    ],
    sourceTargets: new Map([
      [1, [1]],
      [2, [2]],
    ]),
  },
  {
    id: "P4",
    acceptedNames: ["Fagotti", "Bassoons"],
    players: [
      { name: "Bassoon 1", shortName: "Bsn. 1" },
      { name: "Bassoon 2", shortName: "Bsn. 2" },
    ],
    sourceTargets: new Map([
      [1, [1]],
      [2, [2]],
    ]),
  },
  {
    id: "P5",
    acceptedNames: ["Corni in F"],
    players: [
      { name: "Horn in F 1", shortName: "Cor. 1" },
      { name: "Horn in F 2", shortName: "Cor. 2" },
    ],
    sourceTargets: new Map([[1, [1, 2]]]),
  },
  {
    id: "P6",
    acceptedNames: ["Trombe in Bb"],
    players: [
      { name: "Trumpet in Bb 1", shortName: "Tr. 1" },
      { name: "Trumpet in Bb 2", shortName: "Tr. 2" },
    ],
    sourceTargets: new Map([[1, [1, 2]]]),
  },
  {
    id: "P7",
    acceptedNames: ["Tromboni"],
    players: [
      { name: "Trombone 1", shortName: "Tbn. 1" },
      { name: "Trombone 2", shortName: "Tbn. 2" },
      { name: "Trombone 3", shortName: "Tbn. 3" },
    ],
    sourceTargets: new Map([
      [1, [1, 2]],
      [2, [3]],
    ]),
  },
];
