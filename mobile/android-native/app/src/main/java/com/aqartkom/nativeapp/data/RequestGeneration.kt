package com.aqartkom.nativeapp.data

/** UI-thread ownership of asynchronous results, including requests cancelled by Back. */
internal class RequestGeneration {
    fun current(): Long = generation
    private var generation = 0L
    fun next(): Long = ++generation
    fun accepts(token: Long): Boolean = token == generation
}
