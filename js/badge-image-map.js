// 勋章ID -> SVG图片路径映射
var badgeImageMap = {
  // 成就类 (achievement/01-30)
  badge_ach_001: 'images/badges/achievement/01_%E5%88%9D%E6%9D%A5%E4%B9%8D%E5%88%B0.svg',
  badge_ach_002: 'images/badges/achievement/02_%E4%B8%83%E6%97%A5%E8%BF%9E%E7%AD%BE.svg',
  badge_ach_003: 'images/badges/achievement/03_%E4%B8%89%E5%8D%81%E6%97%A5%E8%BF%9E%E7%AD%BE.svg',
  badge_ach_004: 'images/badges/achievement/04_%E9%A6%96%E5%B8%96%E7%BA%AA%E5%BF%B5.svg',
  badge_ach_005: 'images/badges/achievement/05_%E7%99%BE%E5%B8%96%E5%AE%97%E5%B8%88.svg',
  badge_ach_006: 'images/badges/achievement/06_%E5%8D%83%E5%B8%96%E4%BC%A0%E8%AF%B4.svg',
  badge_ach_007: 'images/badges/achievement/07_%E9%A6%96%E8%B5%9E%E8%BE%BE%E4%BA%BA.svg',
  badge_ach_008: 'images/badges/achievement/08_%E7%99%BE%E8%B5%9E%E6%94%B6%E5%89%B2.svg',
  badge_ach_009: 'images/badges/achievement/09_%E5%8D%83%E8%B5%9E%E4%B9%8B%E6%98%9F.svg',
  badge_ach_010: 'images/badges/achievement/10_%E4%B8%87%E8%B5%9E%E4%BC%A0%E5%A5%87.svg',
  badge_ach_011: 'images/badges/achievement/11_%E6%B2%99%E5%8F%91%E4%B9%8B%E7%8E%8B.svg',
  badge_ach_012: 'images/badges/achievement/12_%E8%AF%84%E8%AE%BA%E6%96%B0%E6%98%9F.svg',
  badge_ach_013: 'images/badges/achievement/13_%E8%AF%9D%E5%94%A0%E9%99%84%E4%BD%93.svg',
  badge_ach_014: 'images/badges/achievement/14_%E6%9C%80%E4%BD%B3%E7%AD%94%E6%A1%88.svg',
  badge_ach_015: 'images/badges/achievement/15_%E7%AD%94%E7%96%91%E4%B8%93%E5%AE%B6.svg',
  badge_ach_016: 'images/badges/achievement/16_%E6%82%AC%E8%B5%8F%E7%8C%8E%E4%BA%BA.svg',
  badge_ach_017: 'images/badges/achievement/17_%E5%85%B3%E6%B3%A8%E7%A0%B4%E7%99%BE.svg',
  badge_ach_018: 'images/badges/achievement/18_%E4%B8%87%E4%BA%BA%E8%BF%B7.svg',
  badge_ach_019: 'images/badges/achievement/19_%E5%AE%8C%E7%BE%8E%E6%A1%A3%E6%A1%88.svg',
  badge_ach_020: 'images/badges/achievement/20_%E5%AE%9E%E5%90%8D%E5%85%88%E9%94%8B.svg',
  badge_ach_021: 'images/badges/achievement/21_%E6%B0%B8%E4%B9%85%E5%B1%85%E6%B0%91.svg',
  badge_ach_022: 'images/badges/achievement/22_%E4%B8%89%E6%9C%9D%E5%85%83%E8%80%81.svg',
  badge_ach_023: 'images/badges/achievement/23_%E6%B7%B1%E5%A4%9C%E6%B4%BB%E8%B7%83.svg',
  badge_ach_024: 'images/badges/achievement/24_%E6%97%A9%E8%B5%B7%E9%B8%9F%E5%84%BF.svg',
  badge_ach_025: 'images/badges/achievement/25_%E5%8D%9A%E5%AE%A2%E8%BE%BE%E4%BA%BA.svg',
  badge_ach_026: 'images/badges/achievement/26_%E6%89%93%E8%B5%8F%E6%96%B0%E8%B4%B5.svg',
  badge_ach_027: 'images/badges/achievement/27_%E8%B4%A2%E6%BA%90%E5%B9%BF%E8%BF%9B.svg',
  badge_ach_028: 'images/badges/achievement/28_%E6%85%B7%E6%85%A8%E8%A7%A3%E5%9B%8A.svg',
  badge_ach_029: 'images/badges/achievement/29_%E4%BA%94%E6%98%9F%E5%A5%BD%E8%AF%84.svg',
  badge_ach_030: 'images/badges/achievement/30_%E4%B8%BE%E6%8A%A5%E5%8D%AB%E5%A3%AB.svg',

  // 通用类 (general/31-40)
  badge_gen_01: 'images/badges/general/31_%E9%9C%93%E8%99%B9%E4%B9%8B%E5%BF%83.svg',
  badge_gen_02: 'images/badges/general/32_%E6%95%B0%E5%AD%97%E5%B9%BD%E7%81%B5.svg',
  badge_gen_03: 'images/badges/general/33_%E5%83%8F%E7%B4%A0%E6%96%B9%E5%9D%97.svg',
  badge_gen_04: 'images/badges/general/34_%E8%B5%9B%E5%8D%9A%E4%B9%8B%E7%9C%BC.svg',
  badge_gen_05: 'images/badges/general/35_%E7%9F%A9%E9%98%B5%E9%9B%A8%E6%BB%B4.svg',
  badge_gen_06: 'images/badges/general/36_%E5%A4%AA%E7%A9%BA%E6%BC%AB%E6%B8%B8.svg',
  badge_gen_07: 'images/badges/general/37_%E9%9B%B7%E9%9C%86%E4%B9%8B%E6%80%92.svg',
  badge_gen_08: 'images/badges/general/38_%E5%87%A4%E5%87%B0%E6%B6%85%E6%A7%83.svg',
  badge_gen_09: 'images/badges/general/39_%E6%9E%81%E5%85%89%E4%B9%8B%E8%88%9E.svg',
  badge_gen_10: 'images/badges/general/40_%E5%B9%B8%E8%BF%90%E5%9B%9B%E5%8F%B6.svg',

  // 技术类 (tech/41-52)
  badge_tech_01: 'images/badges/tech/41_Python%E4%B9%8B%E8%9B%87.svg',
  badge_tech_02: 'images/badges/tech/42_Rust%E9%93%81%E9%94%88.svg',
  badge_tech_03: 'images/badges/tech/43_JS%E5%BF%8D%E8%80%85.svg',
  badge_tech_04: 'images/badges/tech/44_Go%E5%9C%B0%E9%BC%A0.svg',
  badge_tech_05: 'images/badges/tech/45_Docker%E9%B2%B8%E9%B1%BC.svg',
  badge_tech_06: 'images/badges/tech/46_K8s%E8%88%B5%E6%89%8B.svg',
  badge_tech_07: 'images/badges/tech/47_Git%E7%8C%AB%E5%A4%B4%E9%B9%B0.svg',
  badge_tech_08: 'images/badges/tech/48_AI%E9%A9%AF%E5%85%BD%E5%B8%88.svg',
  badge_tech_09: 'images/badges/tech/49_%E5%AE%89%E5%85%A8%E9%94%81%E5%8C%A0.svg',
  badge_tech_10: 'images/badges/tech/50_Linux%E4%BC%81%E9%B9%85.svg',
  badge_tech_11: 'images/badges/tech/51_%E6%95%B0%E6%8D%AE%E5%BA%93%E9%BE%99.svg',
  badge_tech_12: 'images/badges/tech/52_%E5%85%A8%E6%A0%88%E7%8B%AC%E8%A7%92%E5%85%BD.svg',

  // 社交类 (social/53-60)
  badge_soc_01: 'images/badges/social/53_%E7%82%B9%E8%B5%9E%E7%8B%82%E9%AD%94.svg',
  badge_soc_02: 'images/badges/social/54_%E6%B2%99%E5%8F%91%E7%8C%8E%E4%BA%BA.svg',
  badge_soc_03: 'images/badges/social/55_%E6%AE%B5%E5%AD%90%E6%89%8B.svg',
  badge_soc_04: 'images/badges/social/56_%E5%92%8C%E5%B9%B3%E4%BD%BF%E8%80%85.svg',
  badge_soc_05: 'images/badges/social/57_%E7%A4%BE%E4%BA%A4%E8%9D%B4%E8%9D%B6.svg',
  badge_soc_06: 'images/badges/social/58_%E6%B4%BE%E5%AF%B9%E8%BE%BE%E4%BA%BA.svg',
  badge_soc_07: 'images/badges/social/59_%E7%9F%A5%E5%BF%83%E4%BC%99%E4%BC%B4.svg',
  badge_soc_08: 'images/badges/social/60_%E9%94%A6%E9%B2%A4%E9%99%84%E4%BD%93.svg',

  // 限定类 (limited/61-65)
  badge_spc_01: 'images/badges/limited/61_%E6%96%B0%E5%B9%B4%E5%BF%AB%E4%B9%90.svg',
  badge_spc_02: 'images/badges/limited/62_%E4%B8%AD%E7%A7%8B%E5%9B%A2%E5%9C%86.svg',
  badge_spc_04: 'images/badges/limited/63_%E4%B8%87%E5%9C%A3%E6%83%8A%E9%AD%82.svg',
  badge_spc_05: 'images/badges/limited/64_%E5%9C%A3%E8%AF%9E%E8%80%81%E4%BA%BA.svg',
  badge_spc_08: 'images/badges/limited/65_%E5%91%A8%E5%B9%B4%E5%BA%86.svg',

  // 特殊 (special/66-67)
  badge_spc_09: 'images/badges/special/66_%E5%86%85%E6%B5%8B%E5%85%88%E9%94%8B.svg',
  badge_spc_10: 'images/badges/special/67_Bug%E7%8C%8E%E4%BA%BA.svg',

  // 声望勋章 (special/68-70)
  badge_rep_01: 'images/badges/special/68_%E9%9D%92%E9%93%9C%E5%8B%8B%E7%AB%A0.svg',
  badge_rep_02: 'images/badges/special/69_%E7%99%BD%E9%93%B6%E5%8B%8B%E7%AB%A0.svg',
  badge_rep_03: 'images/badges/special/70_%E9%BB%84%E9%87%91%E5%8B%8B%E7%AB%A0.svg',

  // 铂金勋章和钻石勋章暂用青铜/白银/黄金替代
  badge_rep_04: 'images/badges/special/69_%E7%99%BD%E9%93%B6%E5%8B%8B%E7%AB%A0.svg',
  badge_rep_05: 'images/badges/special/70_%E9%BB%84%E9%87%91%E5%8B%8B%E7%AB%A0.svg',
};

function badgeImg(id, classes) {
  var src = badgeImageMap[id] || null;
  if (src) {
    return '<img src="' + src + '" alt="" class="' + (classes||'badge-img') + '" loading="lazy">';
  }
  return '<span class="badge-emoji">◈</span>';
}
