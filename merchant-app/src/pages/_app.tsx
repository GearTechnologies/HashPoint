import type { AppProps } from "next/app";
import Head from "next/head";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0B1E3D" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="manifest" href="/manifest.json" />
        <title>HashPoint</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
