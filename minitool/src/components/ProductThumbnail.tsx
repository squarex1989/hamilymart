import { useState } from "react";
import { originalProductThumbnailUrl, productThumbnailUrl } from "../lib/catalog-style";

/** Offline GLB renders; no additional WebGL context is created for catalog cards. */
export default function ProductThumbnail({ productId, styleIndex, alt = "" }: { productId: string; styleIndex: number; alt?: string }) {
  const source = productThumbnailUrl(productId, styleIndex);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <img src={failedSource === source ? originalProductThumbnailUrl(productId) : source}
    alt={alt} draggable={false} loading="lazy" decoding="async"
    onError={() => { if (failedSource !== source) setFailedSource(source); }} />;
}
