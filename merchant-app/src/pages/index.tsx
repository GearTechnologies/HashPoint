import Head from "next/head";
import fs from "fs";
import path from "path";

interface Props {
  styleBlock: string;
  bodyHtml: string;
}

export default function Home({ styleBlock, bodyHtml }: Props) {
  return (
    <>
      <Head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>HashPoint — Offline-First Crypto Payments</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* eslint-disable-next-line react/no-danger */}
        <style dangerouslySetInnerHTML={{ __html: styleBlock }} />
      </Head>
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </>
  );
}

export async function getStaticProps() {
  const htmlPath = path.join(process.cwd(), "public", "hashpoint-landing.html");
  const raw = fs.readFileSync(htmlPath, "utf8");

  // Extract CSS between <style> and </style>
  const styleMatch = raw.match(/<style>([\s\S]*?)<\/style>/);
  const styleBlock = styleMatch ? styleMatch[1] : "";

  // Extract body content between <body> and </body>
  const bodyMatch = raw.match(/<body>([\s\S]*?)<\/body>/);
  const bodyHtml = bodyMatch ? bodyMatch[1] : "";

  return { props: { styleBlock, bodyHtml } };
}

