/** Tipos de `stock-images.js`, lidos pela interface e pelo typecheck da API. */
export type StockImageRef = { id: number; term: string; section?: string | null };

export const STOCK_ZIP_NAME: string;

export function stockImageName(image: StockImageRef): string;

export function stockZipPath(image: StockImageRef): string;

export function stockImagesBlock(images: StockImageRef[]): string;
