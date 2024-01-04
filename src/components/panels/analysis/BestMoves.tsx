import {
  activeTabAtom,
  engineMovesFamily,
  tabEngineSettingsFamily,
} from "@/atoms/atoms";
import { EngineOptions, GoMode, events } from "@/bindings";
import { TreeDispatchContext } from "@/components/common/TreeStateContext";
import { swapMove } from "@/utils/chessops";
import { useThrottledEffect } from "@/utils/misc";
import { formatScore } from "@/utils/score";
import {
  Accordion,
  ActionIcon,
  Box,
  Code,
  Collapse,
  Group,
  Progress,
  Skeleton,
  Stack,
  Table,
  Text,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconSettings,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import {
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AnalysisRow from "./AnalysisRow";
import EngineSettingsForm from "./EngineSettingsForm";
import { Engine, LocalEngine, stopEngine } from "@/utils/engines";
import { chessopsError, positionFromFen } from "@/utils/chessops";
import * as classes from "./BestMoves.css";
import { match } from "ts-pattern";
import { getBestMoves as localGetBestMoves } from "@/utils/engines";
import { getBestMoves as chessdbGetBestMoves } from "@/utils/chessdb";
import { getBestMoves as lichessGetBestMoves } from "@/utils/lichess";

export const arrowColors = [
  { strong: "blue", pale: "paleBlue" },
  { strong: "green", pale: "paleGreen" },
  { strong: "red", pale: "paleRed" },
  { strong: "yellow", pale: "yellow" }, // there's no paleYellow in chessground
];

interface BestMovesProps {
  id: number;
  engine: Engine;
  fen: string;
  halfMoves: number;
}

export default function BestMovesComponent({
  id,
  engine,
  fen,
  halfMoves,
}: BestMovesProps) {
  const dispatch = useContext(TreeDispatchContext);
  const activeTab = useAtomValue(activeTabAtom);
  const [ev, setEngineVariation] = useAtom(
    engineMovesFamily({ engine: engine.name, tab: activeTab! })
  );
  const [settings, setSettings] = useAtom(
    tabEngineSettingsFamily({
      engineName: engine.name,
      defaultSettings: engine.settings,
      tab: activeTab!,
    })
  );

  const engineVariations = useMemo(() => ev.get(fen) ?? [], [ev, fen]);

  const [settingsOn, toggleSettingsOn] = useToggle();
  const [threat, toggleThreat] = useToggle();
  const depth = engineVariations[0]?.depth ?? 0;
  const nps = Math.floor(engineVariations[0]?.nps / 1000 ?? 0);
  const theme = useMantineTheme();
  const listeners = useRef<(() => void)[]>([]);
  const [progress, setProgress] = useState(0);

  const searchingFen = threat ? swapMove(fen) : fen;

  const [isGameOver, error] = useMemo(() => {
    const [pos, error] = positionFromFen(fen);
    return [pos?.isEnd() ?? false, error];
  }, [fen]);

  useEffect(() => {
    async function waitForMove() {
      const unlisten = await events.bestMovesPayload.listen(({ payload }) => {
        const ev = payload.bestLines;
        if (
          payload.engine === engine.name &&
          payload.tab === activeTab &&
          payload.fen === searchingFen &&
          settings.enabled &&
          !isGameOver
        ) {
          startTransition(() => {
            setEngineVariation((prev) => {
              const newMap = new Map(prev);
              newMap.set(searchingFen, ev);
              return newMap;
            });
            setProgress(payload.progress);
            dispatch({
              type: "SET_SCORE",
              payload: ev[0].score,
            });
          });
        }
      });
      listeners.current.push(unlisten);
    }
    waitForMove();
    return () => {
      listeners.current.forEach((unlisten) => unlisten());
    };
  }, [
    activeTab,
    dispatch,
    id,
    settings.enabled,
    isGameOver,
    searchingFen,
    engine.name,
    setEngineVariation,
  ]);

  const getBestMoves = match(engine.type)
    .with(
      "local",
      () => (fen: string, goMode: GoMode, options: EngineOptions) =>
        localGetBestMoves(engine as LocalEngine, fen, goMode, options)
    )
    .with("chessdb", () => chessdbGetBestMoves)
    .with("lichess", () => lichessGetBestMoves)
    .exhaustive();

  useThrottledEffect(
    () => {
      if (settings.enabled) {
        if (isGameOver) {
          if (engine.type === "local") {
            stopEngine(engine, activeTab!);
          }
        } else {
          getBestMoves(activeTab!, settings.go, {
            fen: searchingFen,
            multipv: settings.options.multipv,
            hash: settings.options.hash,
            threads: settings.options.threads,
            extraOptions: settings.options.extraOptions,
          }).then((moves) => {
            if (moves) {
              const [progress, bestMoves] = moves;
              setEngineVariation((prev) => {
                const newMap = new Map(prev);
                newMap.set(searchingFen, bestMoves);
                return newMap;
              });
              setProgress(progress);
            }
          });
        }
      } else {
        if (engine.type === "local") {
          stopEngine(engine, activeTab!);
        }
      }
    },
    50,
    [
      settings.enabled,
      settings.options,
      settings.go,
      threat,
      searchingFen,
      isGameOver,
    ]
  );

  return useMemo(
    () => (
      <>
        <Box style={{ display: "flex" }}>
          <Stack gap={0} py="1rem">
            <ActionIcon
              size="lg"
              variant={settings.enabled ? "filled" : "transparent"}
              color={id < 4 ? arrowColors[id].strong : theme.primaryColor}
              onClick={() => {
                setSettings((prev) => ({ ...prev, enabled: !prev.enabled }));
              }}
              ml={12}
            >
              {settings.enabled ? (
                <IconPlayerPause size="1rem" />
              ) : (
                <IconPlayerPlay size="1rem" />
              )}
            </ActionIcon>
          </Stack>

          <Accordion.Control>
            <Group justify="space-between">
              <Group align="center">
                <Text fw="bold" fz="xl">
                  {engine.name}
                </Text>
                {settings.enabled &&
                  !isGameOver &&
                  !error &&
                  engineVariations.length === 0 && (
                    <Code fz="xs">Loading...</Code>
                  )}
                {progress < 100 &&
                  settings.enabled &&
                  !isGameOver &&
                  engineVariations.length > 0 && (
                    <Tooltip label={"How fast the engine is running"}>
                      <Code fz="xs">{nps}k nodes/s</Code>
                    </Tooltip>
                  )}
              </Group>
              <Group gap="lg">
                {!isGameOver && engineVariations.length > 0 && (
                  <>
                    <Stack align="center" gap={0}>
                      <Text
                        size="0.7rem"
                        tt="uppercase"
                        fw={700}
                        className={classes.subtitle}
                      >
                        Eval
                      </Text>
                      <Text fw="bold" fz="md">
                        {formatScore(engineVariations[0].score, 1) ?? 0}
                      </Text>
                    </Stack>
                    <Stack align="center" gap={0}>
                      <Text
                        size="0.7rem"
                        tt="uppercase"
                        fw={700}
                        className={classes.subtitle}
                      >
                        Depth
                      </Text>
                      <Text fw="bold" fz="md">
                        {depth}
                      </Text>
                    </Stack>
                  </>
                )}
              </Group>
            </Group>
          </Accordion.Control>
          <ActionIcon.Group>
            <Tooltip label="Check the opponent's threat">
              <ActionIcon
                size="lg"
                onClick={() => toggleThreat()}
                disabled={!settings.enabled}
                variant="transparent"
                mt="auto"
                mb="auto"
              >
                <IconTargetArrow
                  color={threat ? "red" : undefined}
                  size="1rem"
                />
              </ActionIcon>
            </Tooltip>
            <ActionIcon
              size="lg"
              onClick={() => toggleSettingsOn()}
              mr={8}
              mt="auto"
              mb="auto"
            >
              <IconSettings size="1rem" />
            </ActionIcon>
          </ActionIcon.Group>
        </Box>
        <Collapse in={settingsOn} px={30} pb={15}>
          <EngineSettingsForm
            engineName={engine.name}
            settings={settings}
            setSettings={setSettings}
            color={id < 4 ? arrowColors[id].strong : theme.primaryColor}
            remote={engine.type !== "local"}
          />
        </Collapse>

        <Progress
          value={isGameOver ? 0 : progress}
          animated={progress < 100 && settings.enabled && !isGameOver}
          size="xs"
          striped={progress < 100 && !settings.enabled}
          color={id < 4 ? arrowColors[id].strong : theme.primaryColor}
        />
        <Accordion.Panel>
          <Table>
            <Table.Tbody>
              {error && (
                <Table.Tr>
                  <Table.Td>
                    <Text ta="center" my="lg">
                      Invalid position: {chessopsError(error)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {isGameOver && (
                <Table.Tr>
                  <Table.Td>
                    <Text ta="center" my="lg">
                      Game is over
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {!isGameOver &&
                !error &&
                engineVariations.length === 0 &&
                (settings.enabled ? (
                  [...Array(settings.options.multipv)].map((_, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Skeleton height={35} radius="xl" p={5} />
                      </Table.Td>
                    </Table.Tr>
                  ))
                ) : (
                  <Table.Tr>
                    <Table.Td>
                      <Text ta="center" my="lg">
                        {"Engine isn't enabled"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              {!isGameOver &&
                !error &&
                engineVariations.map((engineVariation, index) => {
                  return (
                    <AnalysisRow
                      key={index}
                      moves={engineVariation.sanMoves}
                      score={engineVariation.score}
                      halfMoves={halfMoves}
                      threat={threat}
                    />
                  );
                })}
            </Table.Tbody>
          </Table>
        </Accordion.Panel>
      </>
    ),
    [
      settings,
      theme.primaryColor,
      isGameOver,
      engine.name,
      engineVariations,
      progress,
      nps,
      classes.subtitle,
      depth,
      threat,
      settingsOn,
      setSettings,
      toggleThreat,
      toggleSettingsOn,
      halfMoves,
    ]
  );
}
