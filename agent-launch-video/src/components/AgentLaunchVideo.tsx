import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
} from "remotion";

export const AGENT_LAUNCH_DURATION_FRAMES = 420;

const appleFont =
  '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

const LIVE_QUERY_TEXT = "what world cup games are live?";
const NOTIFY_TEXT = "Notify me about the end result";
const ACK_TEXT = "Sure, you will be notified";
const REPLY_TEXT =
  "Portugal won 3-2 against Argentina. Ronaldo scored the winner at 90+1'!";

const TYPE_START = 126;
const TYPE_DURATION = 54;
const SEND_FRAME = 180;
const ACK_START = 204;
const TYPING_START = 236;
const REPLY_START = 276;
const REPLY_REVEAL_DURATION = 54;
const easeOut = Easing.bezier(0.19, 1, 0.22, 1);
const easeInOut = Easing.bezier(0.85, 0, 0.15, 1);

export const AgentLaunchVideo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={styles.root}>
      <AmbientCanvas frame={frame} />

      <Interactive.Div
        style={{
          ...styles.chatFrame,
          opacity: interpolate(frame, [0, 24], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          }),
          scale: interpolate(frame, [0, 32, 352, 390], [0.96, 1, 1, 0.965], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          }),
          translate: interpolate(
            frame,
            [0, 32, 352, 390],
            ["0px 56px", "0px 0px", "0px 0px", "0px -34px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: easeOut,
            },
          ),
        }}
      >
        <IPhoneMock>
          <IMessagePanel frame={frame} />
        </IPhoneMock>
      </Interactive.Div>
    </AbsoluteFill>
  );
};

const AmbientCanvas: React.FC<{ frame: number }> = ({ frame }) => {
  return (
    <AbsoluteFill style={styles.ambient}>
      <div
        style={{
          ...styles.backgroundGrid,
          translate: interpolate(
            frame,
            [0, AGENT_LAUNCH_DURATION_FRAMES],
            ["0px 0px", "-80px -120px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      />
      <div
        style={{
          ...styles.blueField,
          translate: interpolate(frame, [0, 420], ["0px 0px", "-20px -28px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeInOut,
          }),
        }}
      />
      <div
        style={{
          ...styles.greenField,
          translate: interpolate(frame, [0, 420], ["0px 0px", "28px -16px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeInOut,
          }),
        }}
      />
    </AbsoluteFill>
  );
};

const IPhoneMock: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div style={styles.phoneFrame}>
      <div style={styles.dynamicIsland} />
      <div style={styles.phoneInnerBorder} />
      <div style={styles.silentSwitch} />
      <div style={styles.volumeUp} />
      <div style={styles.volumeDown} />
      <div style={styles.powerButton} />
      <div style={styles.phoneScreen}>{children}</div>
    </div>
  );
};

const IMessagePanel: React.FC<{ frame: number }> = ({ frame }) => {
  const typedQuery = revealText(NOTIFY_TEXT, frame, TYPE_START, TYPE_DURATION);
  const hasTypedQuery = typedQuery.length > 0 && frame < SEND_FRAME;

  return (
    <main style={styles.panel}>
      <ContactHeader frame={frame} />

      <section style={styles.transcript}>
        <div
          style={{
            ...styles.transcriptStack,
            translate: interpolate(
              frame,
              [0, 112, 232, 390],
              ["0px 112px", "0px 72px", "0px 34px", "0px -74px"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: easeInOut,
              },
            ),
          }}
        >
          <MessageGroup frame={frame} start={22} side="incoming" time="20:44">
            <MessageBubble side="incoming">How can I help you?</MessageBubble>
          </MessageGroup>

          <MessageGroup frame={frame} start={56} side="outgoing" time="20:45">
            <MessageBubble side="outgoing">{LIVE_QUERY_TEXT}</MessageBubble>
          </MessageGroup>

          <MessageGroup frame={frame} start={90} side="incoming" time="20:45">
            <MessageBubble side="incoming">
              Portugal vs Argentina is about to kick off.
            </MessageBubble>
          </MessageGroup>

          <MessageGroup
            frame={frame}
            start={SEND_FRAME}
            side="outgoing"
            time="20:46"
          >
            <MessageBubble side="outgoing">{NOTIFY_TEXT}</MessageBubble>
          </MessageGroup>

          <MessageGroup
            frame={frame}
            start={ACK_START}
            side="incoming"
            time="20:46"
          >
            <MessageBubble side="incoming">{ACK_TEXT}</MessageBubble>
          </MessageGroup>

          <TypingIndicator frame={frame} start={TYPING_START} />

          <MessageGroup
            frame={frame}
            start={REPLY_START}
            side="incoming"
            time="22:59"
            tight
          >
            <MessageBubble side="incoming">
              {revealText(
                REPLY_TEXT,
                frame,
                REPLY_START,
                REPLY_REVEAL_DURATION,
              )}
            </MessageBubble>
            <ScorePreview frame={frame} start={REPLY_START + 16} />
          </MessageGroup>
        </div>
      </section>

      <Composer
        frame={frame}
        showTypedText={hasTypedQuery}
        typedText={typedQuery}
      />
    </main>
  );
};

const ContactHeader: React.FC<{ frame: number }> = ({ frame }) => {
  return (
    <header style={styles.header}>
      <Interactive.Div
        style={{
          ...styles.avatar,
          opacity: interpolate(frame, [12, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          }),
          scale: interpolate(frame, [12, 30], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({
              damping: 210,
              stiffness: 110,
              overshootClamping: false,
            }),
          }),
        }}
      >
        JM
      </Interactive.Div>
      <Interactive.Div
        style={{
          ...styles.contactName,
          opacity: interpolate(frame, [18, 34], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          }),
          translate: interpolate(frame, [18, 34], ["0px 8px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          }),
        }}
      >
        LabJM Assistant
      </Interactive.Div>
    </header>
  );
};

const MessageGroup: React.FC<{
  children: ReactNode;
  frame: number;
  side: "incoming" | "outgoing";
  start: number;
  tight?: boolean;
  time?: string;
}> = ({ children, frame, side, start, tight = false, time }) => {
  return (
    <div
      style={{
        ...styles.messageGroup,
        alignItems: side === "outgoing" ? "flex-end" : "flex-start",
        marginTop: tight ? -40 : start > 30 ? 20 : 0,
        opacity: interpolate(frame, [start, start + 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeOut,
        }),
        scale: interpolate(frame, [start, start + 8], [0.99, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeOut,
        }),
        translate: interpolate(
          frame,
          [start, start + 8],
          [side === "outgoing" ? "14px 14px" : "-14px 14px", "0px 0px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          },
        ),
      }}
    >
      {children}
      {time ? (
        <span
          style={
            side === "outgoing" ? styles.outgoingTime : styles.incomingTime
          }
        >
          {time}
        </span>
      ) : null}
    </div>
  );
};

const MessageBubble: React.FC<{
  children: ReactNode;
  side: "incoming" | "outgoing";
  strong?: boolean;
}> = ({ children, side, strong = false }) => {
  return (
    <div
      style={{
        ...styles.messageBubble,
        ...(side === "outgoing"
          ? styles.outgoingBubble
          : styles.incomingBubble),
        fontWeight: strong ? 700 : 500,
      }}
    >
      {children}
    </div>
  );
};

const TypingIndicator: React.FC<{ frame: number; start: number }> = ({
  frame,
  start,
}) => {
  const pulseFrame = Math.max(0, frame - start) % 42;

  return (
    <div
      style={{
        ...styles.typingRow,
        opacity: interpolate(
          frame,
          [start, start + 7, REPLY_START - 7, REPLY_START],
          [0, 1, 1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          },
        ),
        scale: interpolate(
          frame,
          [start, start + 7, REPLY_START - 7, REPLY_START],
          [0.99, 1, 1, 0.99],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          },
        ),
        translate: interpolate(
          frame,
          [start, start + 7, REPLY_START - 7, REPLY_START],
          ["-10px 10px", "0px 0px", "0px 0px", "-8px -4px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          },
        ),
      }}
    >
      <div style={styles.typingBubble}>
        {[0, 7, 14].map((offset) => (
          <span
            key={offset}
            style={{
              ...styles.typingDot,
              opacity: interpolate(
                (pulseFrame + 42 - offset) % 42,
                [0, 10, 20, 42],
                [0.35, 1, 0.35, 0.35],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: easeInOut,
                },
              ),
              scale: interpolate(
                (pulseFrame + 42 - offset) % 42,
                [0, 10, 20, 42],
                [0.9, 1.08, 0.9, 0.9],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: easeInOut,
                },
              ),
            }}
          />
        ))}
      </div>
    </div>
  );
};

const ScorePreview: React.FC<{ frame: number; start: number }> = ({
  frame,
  start,
}) => {
  return (
    <div
      style={{
        ...styles.scorePreview,
        opacity: interpolate(frame, [start, start + 9], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeOut,
        }),
        scale: interpolate(frame, [start, start + 9], [0.99, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeOut,
        }),
        translate: interpolate(
          frame,
          [start, start + 9],
          ["0px 10px", "0px 0px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easeOut,
          },
        ),
      }}
    >
      <div style={styles.attachmentShell}>
        <div style={styles.attachmentCard}>
          <div style={styles.attachmentTitle}>Final score</div>
          <div style={styles.attachmentScoreRow}>
            <div style={styles.attachmentTeamColumn}>
              <div style={styles.attachmentFlag}>🇵🇹</div>
              <div style={styles.attachmentTeamName}>Portugal</div>
              <ScorerRow align="left" text="12' B. Silva" />
              <ScorerRow align="left" text="90+1' Ronaldo" />
              <ScorerRow align="left" text="90+4' Ramos" />
            </div>
            <div style={styles.attachmentScoreBox}>
              <span style={styles.attachmentScore}>3</span>
              <span style={styles.attachmentScoreSeparator}>-</span>
              <span style={styles.attachmentScore}>2</span>
            </div>
            <div
              style={{ ...styles.attachmentTeamColumn, alignItems: "flex-end" }}
            >
              <div style={styles.attachmentFlag}>🇦🇷</div>
              <div style={{ ...styles.attachmentTeamName, textAlign: "right" }}>
                Argentina
              </div>
              <ScorerRow align="right" text="Messi 38'" />
              <ScorerRow align="right" text="L. Martinez 72'" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ScorerRow: React.FC<{ align: "left" | "right"; text: string }> = ({
  align,
  text,
}) => {
  const isRight = align === "right";

  return (
    <div
      style={{
        ...styles.scorerRow,
        justifyContent: isRight ? "flex-end" : "flex-start",
        textAlign: isRight ? "right" : "left",
      }}
    >
      {isRight ? (
        <>
          <span style={styles.scorerText}>{text}</span>
          <span style={{ ...styles.scorerBall, marginLeft: 6, marginRight: 0 }}>
            ⚽
          </span>
        </>
      ) : (
        <>
          <span style={styles.scorerBall}>⚽</span>
          <span style={styles.scorerText}>{text}</span>
        </>
      )}
    </div>
  );
};

const Composer: React.FC<{
  frame: number;
  showTypedText: boolean;
  typedText: string;
}> = ({ frame, showTypedText, typedText }) => {
  return (
    <footer style={styles.composer}>
      <div style={styles.composerForm}>
        <button style={styles.plusButton} type="button">
          <PlusIcon />
        </button>

        <div style={styles.input}>
          <span style={showTypedText ? styles.inputText : styles.placeholder}>
            {showTypedText ? typedText : "iMessage"}
          </span>
          {showTypedText ? (
            <span
              style={{
                ...styles.caret,
                opacity: Math.floor(frame / 15) % 2 === 0 ? 1 : 0,
              }}
            />
          ) : null}
        </div>
      </div>
    </footer>
  );
};

const PlusIcon = () => (
  <svg aria-hidden="true" height="34" viewBox="0 0 34 34" width="34">
    <path
      d="M17 5v24M5 17h24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3.2"
    />
  </svg>
);

const revealText = (
  text: string,
  frame: number,
  start: number,
  duration: number,
) => {
  if (frame < start) {
    return "";
  }

  return text.slice(
    0,
    Math.floor(text.length * Math.min(1, (frame - start) / duration)),
  );
};

const styles: Record<string, CSSProperties> = {
  ambient: {
    background:
      "linear-gradient(145deg, #eef2f6 0%, #f8fafc 52%, #e8f1ff 100%)",
  },
  avatar: {
    alignItems: "center",
    background: "#e5e7eb",
    borderRadius: 56,
    color: "#6b7280",
    display: "flex",
    fontFamily: appleFont,
    fontSize: 29,
    fontWeight: 800,
    height: 86,
    justifyContent: "center",
    width: 86,
  },
  backgroundGrid: {
    backgroundImage:
      "linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)",
    backgroundSize: "80px 80px",
    bottom: -200,
    left: -200,
    position: "absolute",
    right: -200,
    top: -200,
  },
  blueField: {
    background:
      "radial-gradient(circle at 50% 50%, rgba(10,132,255,0.16), rgba(10,132,255,0) 68%)",
    height: 760,
    position: "absolute",
    right: -240,
    top: 260,
    width: 760,
  },
  caret: {
    background: "#0a84ff",
    borderRadius: 2,
    display: "inline-block",
    height: 31,
    marginLeft: 3,
    translate: "0px 5px",
    width: 3,
  },
  chatFrame: {
    height: 1540,
    margin: "auto",
    position: "relative",
    width: 760,
    zIndex: 2,
  },
  composer: {
    background: "#ffffff",
    borderTop: "1px solid #f1f2f4",
    padding: "18px 22px 44px",
  },
  composerForm: {
    alignItems: "center",
    display: "flex",
    gap: 18,
  },
  contactName: {
    color: "#171717",
    fontFamily: appleFont,
    fontSize: 27,
    fontWeight: 700,
    lineHeight: "32px",
  },
  greenField: {
    background:
      "radial-gradient(circle at 50% 50%, rgba(34,197,94,0.13), rgba(34,197,94,0) 70%)",
    bottom: 80,
    height: 700,
    left: -240,
    position: "absolute",
    width: 700,
  },
  header: {
    alignItems: "center",
    background: "#ffffff",
    borderBottom: "1px solid #e5e7eb",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    height: 232,
    justifyContent: "flex-start",
    padding: "86px 32px 18px",
  },
  incomingBubble: {
    background: "#f1f2f4",
    borderBottomLeftRadius: 6,
    color: "#171717",
  },
  incomingTime: {
    color: "#8e8e93",
    fontFamily: appleFont,
    fontSize: 18,
    fontWeight: 500,
    marginLeft: 10,
    marginTop: 4,
  },
  input: {
    alignItems: "center",
    background: "#ffffff",
    borderRadius: 999,
    boxShadow: "0 14px 34px rgba(15,23,42,0.08)",
    color: "#171717",
    display: "flex",
    flex: 1,
    fontFamily: appleFont,
    fontSize: 29,
    height: 74,
    minWidth: 0,
    overflow: "hidden",
    padding: "0 34px",
  },
  inputText: {
    color: "#171717",
    minWidth: 0,
    whiteSpace: "pre",
  },
  messageBubble: {
    borderRadius: 28,
    fontFamily: appleFont,
    fontSize: 30,
    lineHeight: "40px",
    maxWidth: 610,
    padding: "17px 22px 18px",
  },
  messageGroup: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
  },
  outgoingBubble: {
    background: "#0a84ff",
    borderBottomRightRadius: 6,
    color: "#ffffff",
  },
  outgoingTime: {
    color: "#8e8e93",
    fontFamily: appleFont,
    fontSize: 18,
    fontWeight: 500,
    marginRight: 10,
    marginTop: 4,
  },
  panel: {
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    width: "100%",
  },
  phoneFrame: {
    background: "#18181b",
    border: "16px solid #18181b",
    borderRadius: 116,
    boxShadow:
      "0 1px 2px rgba(255,255,255,0.12), 0 24px 60px rgba(15,23,42,0.22)",
    height: "100%",
    position: "relative",
    width: "100%",
  },
  phoneInnerBorder: {
    border: "5px solid rgba(113,113,122,0.4)",
    borderRadius: 98,
    bottom: -2,
    left: -2,
    pointerEvents: "none",
    position: "absolute",
    right: -2,
    top: -2,
    zIndex: 8,
  },
  phoneScreen: {
    background: "#ffffff",
    borderRadius: 98,
    height: "100%",
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  dynamicIsland: {
    background: "#18181b",
    borderRadius: 999,
    height: 46,
    left: "50%",
    position: "absolute",
    top: 16,
    translate: "-50% 0px",
    width: 188,
    zIndex: 20,
  },
  silentSwitch: {
    background: "#18181b",
    borderRadius: "10px 0 0 10px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.3)",
    height: 66,
    left: -28,
    position: "absolute",
    top: 152,
    width: 12,
  },
  volumeUp: {
    background: "#18181b",
    borderRadius: "10px 0 0 10px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.3)",
    height: 98,
    left: -28,
    position: "absolute",
    top: 272,
    width: 12,
  },
  volumeDown: {
    background: "#18181b",
    borderRadius: "10px 0 0 10px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.3)",
    height: 98,
    left: -28,
    position: "absolute",
    top: 412,
    width: 12,
  },
  powerButton: {
    background: "#18181b",
    borderRadius: "0 10px 10px 0",
    boxShadow: "0 1px 2px rgba(15,23,42,0.3)",
    height: 130,
    position: "absolute",
    right: -28,
    top: 278,
    width: 12,
  },
  placeholder: {
    color: "#b7b7bd",
    flex: 1,
    fontWeight: 400,
  },
  root: {
    alignItems: "center",
    display: "flex",
    justifyContent: "center",
    overflow: "hidden",
  },
  scorePill: {
    alignItems: "center",
    background: "#111827",
    borderRadius: 14,
    color: "#ffffff",
    display: "flex",
    fontFamily: appleFont,
    fontSize: 31,
    fontWeight: 800,
    justifyContent: "center",
    padding: "8px 18px",
  },
  scorePreview: {
    background: "#ffffff",
    borderRadius: 22,
    color: "#18181b",
    display: "block",
    fontFamily: appleFont,
    marginTop: 8,
    maxWidth: 610,
    padding: 0,
    width: 610,
  },
  attachmentShell: {
    backgroundColor: "#f8f8f8",
    border: "1px solid #f2f2f2",
    borderRadius: 22,
    height: 314,
    padding: 4,
    width: "100%",
  },
  attachmentCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #f2f2f2",
    borderRadius: 20,
    boxShadow: "0 8px 8px rgba(0,0,0,0.02)",
    height: "100%",
    padding: "22px 26px 30px",
    width: "100%",
  },
  attachmentTitle: {
    color: "#18181b",
    fontFamily: appleFont,
    fontSize: 31,
    fontWeight: 500,
    letterSpacing: -0.8,
    lineHeight: 1.06,
  },
  attachmentScoreRow: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    marginTop: 22,
    width: "100%",
  },
  attachmentTeamColumn: {
    alignItems: "flex-start",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    width: 156,
  },
  attachmentFlag: {
    color: "#000000",
    fontSize: 32,
    fontWeight: 500,
    lineHeight: 1,
  },
  attachmentTeamName: {
    color: "#333333",
    fontFamily: appleFont,
    fontSize: 20,
    fontWeight: 500,
    lineHeight: 1.08,
    marginTop: 9,
  },
  attachmentScoreBox: {
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    border: "1px solid #f2f2f2",
    borderRadius: 24,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
    display: "flex",
    justifyContent: "center",
    padding: "15px 26px",
  },
  attachmentScore: {
    color: "#000000",
    fontSize: 48,
    fontWeight: 500,
    lineHeight: 1,
  },
  attachmentScoreSeparator: {
    color: "#959595",
    fontSize: 30,
    fontWeight: 400,
    lineHeight: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  scorerRow: {
    alignItems: "center",
    color: "#333333",
    display: "flex",
    flexDirection: "row",
    fontFamily: appleFont,
    fontSize: 13,
    fontWeight: 500,
    height: 22,
    lineHeight: 1,
    marginTop: 5,
    width: "100%",
  },
  scorerBall: {
    color: "#000000",
    display: "flex",
    fontFamily: appleFont,
    fontSize: 13,
    lineHeight: 1,
    marginRight: 6,
    width: 17,
  },
  scorerText: {
    color: "#333333",
    display: "flex",
    fontFamily: appleFont,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1,
    maxWidth: 130,
  },
  plusButton: {
    alignItems: "center",
    background: "#ffffff",
    border: "none",
    borderRadius: 42,
    boxShadow: "0 14px 34px rgba(15,23,42,0.08)",
    color: "#000000",
    display: "flex",
    flexShrink: 0,
    height: 74,
    justifyContent: "center",
    padding: 0,
    width: 74,
  },
  transcript: {
    flex: 1,
    overflow: "hidden",
    padding: "30px 28px",
    position: "relative",
  },
  transcriptStack: {
    display: "flex",
    flexDirection: "column",
    position: "relative",
    width: "100%",
  },
  typingBubble: {
    alignItems: "center",
    background: "#f1f2f4",
    borderBottomLeftRadius: 6,
    borderRadius: 28,
    display: "flex",
    gap: 9,
    height: 52,
    padding: "0 22px",
  },
  typingDot: {
    background: "rgba(107,114,128,0.68)",
    borderRadius: 8,
    display: "block",
    height: 11,
    width: 11,
  },
  typingRow: {
    alignItems: "flex-start",
    display: "flex",
    marginTop: 22,
  },
};
