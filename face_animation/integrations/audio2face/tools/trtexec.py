"""Build the Audio2Face TensorRT engine with the official Python wheel."""

from __future__ import annotations

import argparse
from pathlib import Path

import tensorrt as trt


def parse_shapes(value: str) -> dict[str, tuple[int, ...]]:
    result: dict[str, tuple[int, ...]] = {}
    for item in value.split(","):
        name, raw_shape = item.split(":", 1)
        result[name] = tuple(int(dim) for dim in raw_shape.split("x"))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx", required=True)
    parser.add_argument("--saveEngine", required=True)
    parser.add_argument("--minShapes", required=True)
    parser.add_argument("--optShapes", required=True)
    parser.add_argument("--maxShapes", required=True)
    parser.add_argument("--memPoolSize", action="append", default=[])
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--versionCompatible", action="store_true")
    parser.add_argument("--hardwareCompatibilityLevel")
    parser.add_argument("--device")
    args, unknown = parser.parse_known_args()

    logger = trt.Logger(trt.Logger.INFO)
    try:
        trt.init_libnvinfer_plugins(logger, "")
    except AttributeError:
        pass
    builder = trt.Builder(logger)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
    onnx_parser = trt.OnnxParser(network, logger)
    if not onnx_parser.parse_from_file(str(Path(args.onnx).resolve())):
        for index in range(onnx_parser.num_errors):
            print(onnx_parser.get_error(index))
        raise RuntimeError("TensorRT could not parse the Audio2Face ONNX model")

    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 8 * 1024**3)
    for setting in args.memPoolSize:
        pool_name, amount = setting.split(":", 1)
        if pool_name == "tacticSharedMem":
            config.set_memory_pool_limit(trt.MemoryPoolType.TACTIC_SHARED_MEMORY, int(float(amount) * 1024**3))

    minimum, optimum, maximum = parse_shapes(args.minShapes), parse_shapes(args.optShapes), parse_shapes(args.maxShapes)
    profile = builder.create_optimization_profile()
    for name, min_shape in minimum.items():
        profile.set_shape(name, min_shape, optimum[name], maximum[name])
    config.add_optimization_profile(profile)
    if args.fp16:
        config.set_flag(trt.BuilderFlag.FP16)
    if args.versionCompatible:
        config.set_flag(trt.BuilderFlag.VERSION_COMPATIBLE)
    if args.hardwareCompatibilityLevel:
        config.hardware_compatibility_level = trt.HardwareCompatibilityLevel.AMPERE_PLUS

    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError("TensorRT engine build failed")
    destination = Path(args.saveEngine).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(bytes(serialized))
    print(f"Saved {destination} ({destination.stat().st_size / 1024**2:.1f} MiB)")
    if unknown:
        print("Ignored unsupported trtexec options:", " ".join(unknown))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
