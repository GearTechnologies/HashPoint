import type { AppProps } from "next/app";
import Head from "next/head";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0052CC" />
        <link rel="manifest" href="/manifest.json" />
        <title>HashPoint</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
