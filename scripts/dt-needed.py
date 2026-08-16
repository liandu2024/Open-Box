#!/usr/bin/env python3
"""解析 ELF 文件的程序头,用于构建期的依赖白名单守卫。

不依赖 pyelftools/readelf/objdump——手工解析 ELF 程序头找到 PT_DYNAMIC 段,
再遍历其中的 Elf32/64_Dyn 条目取出 DT_NEEDED,并通过 DT_STRTAB 解出实际的库名
字符串。兼容 32/64 位、大小端。这样即使在 macOS(没有 readelf,系统自带的
objdump 对交叉架构 ELF 的 NEEDED 列表解析也不总是可信——曾在 arm64 musl 二进制
上被验证过与本脚本结果一致但不能保证任何主机都装了对应工具链)上也能跑,
build-release.sh 用它做构建期的依赖白名单守卫(见该脚本 Critical 1 相关注释)。

两种用法:
  python3 dt-needed.py <elf 文件>
      打印该文件的 DT_NEEDED 条目(一行一个);文件必须是动态链接的(有
      PT_DYNAMIC 段),否则失败退出。用于 node 二进制的 DT_NEEDED 白名单校验。

  python3 dt-needed.py --assert-static <elf 文件>
      断言该文件既没有 PT_INTERP 段也没有 PT_DYNAMIC 段,即真正静态链接、不
      依赖任何动态链接器/共享库。有则打印命中的段类型并非零退出。用于
      sing-box 二进制的静态链接校验(build-release.sh Minor 2:防止上游哪天
      把 -musl 资产悄悄换成动态链接构建,而构建期毫无察觉)。

失败时(两种用法皆然)非零退出并把原因打到 stderr。
"""
import struct
import sys

PT_LOAD = 1
PT_DYNAMIC = 2
PT_INTERP = 3


def die(msg):
    print(f"dt-needed.py: {msg}", file=sys.stderr)
    sys.exit(1)


def parse_elf(path):
    """解析 ELF 文件头 + 程序头表。

    返回 (data, endian, is64, phdrs),phdrs 是
    [(p_type, p_offset, p_vaddr, p_filesz), ...] 的列表,顺序与文件中一致。
    """
    with open(path, "rb") as f:
        data = f.read()

    if data[:4] != b"\x7fELF":
        die(f"{path}: 不是 ELF 文件")

    ei_class = data[4]  # 1 = 32 位, 2 = 64 位
    ei_data = data[5]  # 1 = 小端, 2 = 大端
    if ei_class not in (1, 2):
        die(f"{path}: 未知 EI_CLASS {ei_class}")
    if ei_data not in (1, 2):
        die(f"{path}: 未知 EI_DATA {ei_data}")

    endian = "<" if ei_data == 1 else ">"
    is64 = ei_class == 2

    if is64:
        e_phoff = struct.unpack_from(endian + "Q", data, 32)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 54)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 56)[0]
    else:
        e_phoff = struct.unpack_from(endian + "I", data, 28)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 42)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 44)[0]

    phdrs = []
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        if is64:
            p_type, _p_flags, p_offset, p_vaddr, _p_paddr, p_filesz, _p_memsz, _p_align = (
                struct.unpack_from(endian + "IIQQQQQQ", data, off)
            )
        else:
            p_type, p_offset, p_vaddr, _p_paddr, p_filesz, _p_memsz, _p_flags, _p_align = (
                struct.unpack_from(endian + "IIIIIIII", data, off)
            )
        phdrs.append((p_type, p_offset, p_vaddr, p_filesz))

    return data, endian, is64, phdrs


def read_needed(path):
    data, endian, is64, phdrs = parse_elf(path)

    loads = [
        (p_vaddr, p_filesz, p_offset)
        for p_type, p_offset, p_vaddr, p_filesz in phdrs
        if p_type == PT_LOAD
    ]
    dyn = next(
        ((p_offset, p_filesz) for p_type, p_offset, p_vaddr, p_filesz in phdrs if p_type == PT_DYNAMIC),
        None,
    )

    if dyn is None:
        die(f"{path}: 没有 PT_DYNAMIC 段(不是动态链接的 ELF?)")
    dyn_off, dyn_filesz = dyn

    def vaddr_to_offset(vaddr):
        for p_vaddr, p_filesz, p_offset in loads:
            if p_vaddr <= vaddr < p_vaddr + p_filesz:
                return p_offset + (vaddr - p_vaddr)
        die(f"{path}: 无法通过 PT_LOAD 段把虚拟地址 0x{vaddr:x} 映射到文件偏移")

    DT_NULL = 0
    DT_NEEDED = 1
    DT_STRTAB = 5

    dyn_entsize = 16 if is64 else 8
    strtab_vaddr = None
    needed_str_offsets = []

    pos = dyn_off
    end = dyn_off + dyn_filesz
    while pos + dyn_entsize <= end:
        if is64:
            d_tag, d_val = struct.unpack_from(endian + "qQ", data, pos)
        else:
            d_tag, d_val = struct.unpack_from(endian + "iI", data, pos)
        if d_tag == DT_NULL:
            break
        if d_tag == DT_STRTAB:
            strtab_vaddr = d_val
        elif d_tag == DT_NEEDED:
            needed_str_offsets.append(d_val)
        pos += dyn_entsize

    if strtab_vaddr is None:
        die(f"{path}: PT_DYNAMIC 里没有 DT_STRTAB 条目")

    strtab_off = vaddr_to_offset(strtab_vaddr)

    def read_cstr(off):
        end_idx = data.index(b"\x00", off)
        return data[off:end_idx].decode("ascii", "replace")

    return [read_cstr(strtab_off + o) for o in needed_str_offsets]


def assert_static(path):
    """断言 path 既没有 PT_INTERP 也没有 PT_DYNAMIC 段——即真正静态链接,不依赖
    任何动态链接器或共享库。命中任一段则打印具体命中的段类型并非零退出。"""
    _data, _endian, _is64, phdrs = parse_elf(path)
    seg_names = {PT_INTERP: "PT_INTERP", PT_DYNAMIC: "PT_DYNAMIC"}
    found = sorted({p_type for p_type, _off, _vaddr, _filesz in phdrs if p_type in seg_names})
    if found:
        hit = ", ".join(seg_names[t] for t in found)
        die(f"{path}: 不是静态链接的 ELF(存在 {hit} 段)")


def main(argv):
    if len(argv) == 3 and argv[1] == "--assert-static":
        assert_static(argv[2])
        return
    if len(argv) != 2:
        die(f"用法: {argv[0]} <elf 文件>  或  {argv[0]} --assert-static <elf 文件>")
    for name in read_needed(argv[1]):
        print(name)


if __name__ == "__main__":
    main(sys.argv)
