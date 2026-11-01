export const normalizeContact = (value: string) => value.trim().toLowerCase();
export const validContact = (value: string) => value.trim().length >= 5 && value.trim().length <= 254 && !/[\u0000-\u001f\u007f]/.test(value);
export const validQueryPassword = (value: string) => value.length >= 8 && value.length <= 64 && /\S/.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
