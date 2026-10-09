/** Tipos de `stock-images.js` para a interface (TypeScript). */
export type StockImageRef = { id: number; term: string; section?: string | null };

export const STOCK_ZIP_NAME: string;

export function stockSlug(text: string | null | undefined): string;

export function stockGroupOf(image: StockImageRef): string;

export function stockImageName(image: StockImageRef): string;

export function stockZipPath(image: StockImageRef): string;

export function stockImagesBlock(images: StockImageRef[]): string;
