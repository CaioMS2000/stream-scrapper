type ConstructorWithGenerics<T> = new (...args: any[]) => T
type Constructor = new (...args: any[]) => any

function isConstructor(value: unknown): value is Constructor {
	try {
		Reflect.construct(String, [], value as any)
		return true
	} catch {
		return false
	}
}

// Error
export class Failure<L, R> {
	readonly value: L

	constructor(value: L) {
		this.value = value
	}

	isSuccess(): this is Success<L, R> {
		return false
	}

	isFailure(): this is Failure<L, R> {
		return true
	}
}

// Success
export class Success<L, R> {
	readonly value: R

	constructor(value: R) {
		this.value = value
	}

	isSuccess(): this is Success<L, R> {
		return true
	}

	isFailure(): this is Failure<L, R> {
		return false
	}
}

export type Result<L, R> = Failure<L, R> | Success<L, R>

export type FailureOf<T extends Result<any, any>> =
	T extends Result<infer L, any> ? L : never

export type SuccessOf<T extends Result<any, any>> =
	T extends Result<any, infer R> ? R : never

export function failure<L extends Constructor>(
	value: L
): Result<InstanceType<L>, never>
export function failure<L>(value: L): Result<L, never>
export function failure<L>(value: L | Constructor): Result<any, never> {
	if (isConstructor(value)) {
		return new Failure(new value())
	}

	return new Failure(value)
}

export function success<R extends Constructor>(
	value: R
): Result<never, InstanceType<R>>
export function success<R>(value: R): Result<never, R>
export function success<R>(value: R | Constructor): Result<never, any> {
	if (isConstructor(value)) {
		return new Success(new value())
	}

	return new Success(value)
}
