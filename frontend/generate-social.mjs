// Generates public/social.png using satori + @resvg/resvg-js
// Run: node generate-social.mjs

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFont(weight) {
  // @fontsource/sora ships woff1 files which satori's opentype.js can parse
  return fs.readFileSync(
    path.join(
      __dirname,
      `node_modules/@fontsource/sora/files/sora-latin-${weight}-normal.woff`
    )
  );
}

async function main() {
  console.log("Loading fonts…");
  const soraRegular = loadFont(400);
  const soraSemiBold = loadFont(600);
  const soraBold = loadFont(700);

  const WIDTH = 1200;
  const HEIGHT = 630;

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          backgroundColor: "#09090b",
          display: "flex",
          flexDirection: "column",
          padding: "72px 80px 64px",
          fontFamily: "Sora",
          position: "relative",
          overflow: "hidden",
        },
        children: [
          // Background glow — top right
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: "-120px",
                right: "-120px",
                width: "520px",
                height: "520px",
                borderRadius: "50%",
                background:
                  "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(139,92,246,0.04) 60%, transparent 100%)",
              },
            },
          },
          // Background glow — bottom left
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: "-80px",
                left: "-80px",
                width: "360px",
                height: "360px",
                borderRadius: "50%",
                background:
                  "linear-gradient(315deg, rgba(139,92,246,0.10) 0%, transparent 70%)",
              },
            },
          },
          // Decorative large faint "brrr" in background
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                right: "60px",
                bottom: "80px",
                fontSize: "200px",
                fontWeight: 800,
                color: "rgba(139,92,246,0.05)",
                letterSpacing: "-6px",
                lineHeight: 1,
                userSelect: "none",
              },
              children: "brrr",
            },
          },
          // Purple top accent bar
          {
            type: "div",
            props: {
              style: {
                width: "56px",
                height: "4px",
                backgroundColor: "#8b5cf6",
                borderRadius: "2px",
                marginBottom: "52px",
              },
            },
          },
          // Main title
          {
            type: "div",
            props: {
              style: {
                fontSize: "88px",
                fontWeight: 700,
                color: "#fafafa",
                letterSpacing: "-3px",
                lineHeight: 1.05,
                marginBottom: "28px",
              },
              children: "does JIT go brrr?",
            },
          },
          // Subtitle
          {
            type: "div",
            props: {
              style: {
                fontSize: "30px",
                fontWeight: 600,
                color: "#a78bfa",
                marginBottom: "14px",
                letterSpacing: "-0.5px",
              },
              children: "CPython JIT Performance Tracker",
            },
          },
          // Description
          {
            type: "div",
            props: {
              style: {
                fontSize: "20px",
                fontWeight: 400,
                color: "#52525b",
                lineHeight: 1.5,
              },
              children:
                "Daily benchmarks across multiple machines using pyperformance",
            },
          },
          // Spacer
          {
            type: "div",
            props: { style: { flex: 1 } },
          },
          // Footer row
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "18px",
                      color: "#3f3f46",
                      fontWeight: 500,
                    },
                    children: "doesjitgobrrr.com",
                  },
                },
                // Dot separator row
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: "#8b5cf6",
                          },
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: "rgba(139,92,246,0.5)",
                          },
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: "rgba(139,92,246,0.2)",
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: "Sora", data: soraRegular, weight: 400, style: "normal" },
        { name: "Sora", data: soraSemiBold, weight: 600, style: "normal" },
        { name: "Sora", data: soraBold, weight: 700, style: "normal" },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    background: "#09090b",
    fitTo: { mode: "width", value: WIDTH },
  });
  const pngData = resvg.render();
  const outPath = path.join(__dirname, "public/social.png");
  fs.writeFileSync(outPath, pngData.asPng());
  console.log(`Generated ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
